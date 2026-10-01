import { db } from './db'
import type { SavedSystemLease } from './imports'

type Citation = { leaseId: string; title: string; page: number }

/** A period of the base rent schedule; dates are YYYY-MM-DD, end inclusive (empty: open-ended). */
export type RentStep = { start_date: string; end_date: string; monthly_rent: number; description: string }
export type RentAbatement = { start_date: string; end_date: string; percent: number; description: string }

/** Base rent schedule extracted from the lease family (lease_insights.rent). */
export type RentTerms = {
  has_rent: boolean
  steps: RentStep[]
  abatements: RentAbatement[]
  escalation_terms: string
  payment_terms: string
  late_fee_terms: string
  citations: Citation[]
}

/** What the user enters: the months audited and the base rent billed in each (null: not entered). */
export type RentAuditInputs = {
  startMonth: string
  endMonth: string
  billed: Record<string, number | null>
}

export type RentAuditLine = {
  month: string
  scheduled: number
  abatement: number
  expected: number
  billed: number | null
  // billed − expected: negative is under-billed, positive over-billed; null when not entered.
  variance: number | null
}

export type RentAuditResult = {
  lines: RentAuditLine[]
  totalExpected: number
  totalBilled: number
  underBilled: number
  overBilled: number
  // underBilled − overBilled: what the tenant still owes (negative: credit due).
  net: number
  monthsMissing: number
}

export type SavedRentAudit = {
  id: string
  lease_id: string
  start_month: string
  end_month: string
  inputs: RentAuditInputs
  result: RentAuditResult
  notes: string | null
  updated_at: string
}

const cents = (n: number) => Math.round(n * 100) / 100
const OPEN_END = '9999-12-31'
const pad = (n: number) => String(n).padStart(2, '0')

export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const monthOf = (iso: string) => iso.slice(0, 7)

const covers = (p: { start_date: string; end_date: string }, iso: string) => p.start_date <= iso && iso <= (p.end_date || OPEN_END)

/** The step in effect on a date. */
export const stepOn = (terms: RentTerms, iso: string) => terms.steps.find((s) => covers(s, iso)) ?? null

/** The first rent step starting after a date. */
export const nextStep = (terms: RentTerms, iso: string) => terms.steps.find((s) => s.start_date > iso) ?? null

/** Months from start to end inclusive, as YYYY-MM. */
export function monthsBetween(start: string, end: string): string[] {
  const months: string[] = []
  let [y, m] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  while ((y < ey || (y === ey && m <= em)) && months.length < 1200) {
    months.push(`${y}-${pad(m)}`)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return months
}

export function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + count, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/**
 * Base rent the lease requires for one month. Each day carries 1/days-in-month
 * of the monthly rent of the step in effect that day, so steps and abatements
 * that start or end mid-month (and partial first and last months) are prorated.
 */
export function rentForMonth(terms: RentTerms, month: string) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  let scheduled = 0
  let abatement = 0
  for (let d = 1; d <= days; d++) {
    const iso = `${month}-${pad(d)}`
    const step = stepOn(terms, iso)
    if (!step) continue
    const daily = step.monthly_rent / days
    const abated = Math.min(Math.max(0, ...terms.abatements.filter((a) => covers(a, iso)).map((a) => a.percent)), 100)
    scheduled += daily
    abatement += (daily * abated) / 100
  }
  return { scheduled: cents(scheduled), abatement: cents(abatement), expected: cents(scheduled - abatement) }
}

/** Month-by-month comparison of the rent the lease requires with what was billed. */
export function calculateRentAudit(terms: RentTerms, inputs: RentAuditInputs): RentAuditResult {
  const lines = monthsBetween(inputs.startMonth, inputs.endMonth).map((month): RentAuditLine => {
    const rent = rentForMonth(terms, month)
    const billed = inputs.billed[month] ?? null
    return { month, ...rent, billed, variance: billed === null ? null : cents(billed - rent.expected) }
  })
  const entered = lines.filter((l) => l.variance !== null)
  const underBilled = cents(entered.reduce((n, l) => n + Math.max(-(l.variance ?? 0), 0), 0))
  const overBilled = cents(entered.reduce((n, l) => n + Math.max(l.variance ?? 0, 0), 0))
  return {
    lines,
    totalExpected: cents(lines.reduce((n, l) => n + l.expected, 0)),
    totalBilled: cents(entered.reduce((n, l) => n + (l.billed ?? 0), 0)),
    underBilled,
    overBilled,
    net: cents(underBilled - overBilled),
    monthsMissing: lines.length - entered.length,
  }
}

/** Default audit range: the last 12 months up to this month, within the rent schedule. */
export function defaultRange(terms: RentTerms | null, today = new Date()): { startMonth: string; endMonth: string } {
  const current = monthOf(isoDate(today))
  const first = terms?.steps[0] ? monthOf(terms.steps[0].start_date) : null
  const lastEnd = terms?.steps.at(-1)?.end_date
  const last = lastEnd ? monthOf(lastEnd) : null
  const endMonth = last && last < current ? last : current
  let startMonth = addMonths(endMonth, -11)
  if (first && startMonth < first) startMonth = first
  return { startMonth: startMonth <= endMonth ? startMonth : endMonth, endMonth }
}

export type BillingCheck = {
  key: 'current' | 'nextDate' | 'nextRent'
  lease: number | string | null
  system: number | string | null
  status: 'match' | 'mismatch' | 'check'
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01)

/**
 * The rent the lease requires this month and its next step, compared with what
 * the imported system record bills. Uses the full scheduled rent (before abatement)
 * for the next step, and the abated rent for this month.
 */
export function billingChecks(terms: RentTerms, system: SavedSystemLease, today = new Date()): BillingCheck[] {
  const iso = isoDate(today)
  const current = stepOn(terms, iso) ? rentForMonth(terms, monthOf(iso)).expected : null
  const next = nextStep(terms, iso)
  const num = (lease: number | null, sys: number | null): BillingCheck['status'] =>
    lease !== null && sys !== null ? (close(lease, sys) ? 'match' : 'mismatch') : 'check'
  const checks: BillingCheck[] = [{ key: 'current', lease: current, system: system.monthly_base_rent, status: num(current, system.monthly_base_rent) }]
  if (next || system.next_escalation_date || system.next_escalation_rent !== null) {
    checks.push({
      key: 'nextDate',
      lease: next?.start_date ?? null,
      system: system.next_escalation_date,
      status: next && system.next_escalation_date ? (next.start_date === system.next_escalation_date ? 'match' : 'mismatch') : 'check',
    })
    checks.push({
      key: 'nextRent',
      lease: next?.monthly_rent ?? null,
      system: system.next_escalation_rent,
      status: num(next?.monthly_rent ?? null, system.next_escalation_rent),
    })
  }
  return checks
}

export async function listRentAudits(familyId: string): Promise<SavedRentAudit[]> {
  const { data, error } = await db
    .from('rent_audits')
    .select('*')
    .eq('lease_id', familyId)
    .order('end_month', { ascending: false })
    .order('start_month', { ascending: false })
  if (error) throw new Error(error.message)
  return data as SavedRentAudit[]
}

/** Saves the audit, replacing any earlier one for the same months. */
export async function saveRentAudit(familyId: string, terms: RentTerms, inputs: RentAuditInputs, notes: string) {
  // Only the audited months' billed amounts are kept.
  const months = new Set(monthsBetween(inputs.startMonth, inputs.endMonth))
  const billed = Object.fromEntries(Object.entries(inputs.billed).filter(([m, v]) => months.has(m) && v !== null))
  const saved = { ...inputs, billed }
  const { data, error } = await db
    .from('rent_audits')
    .upsert(
      {
        lease_id: familyId,
        start_month: inputs.startMonth,
        end_month: inputs.endMonth,
        inputs: saved,
        result: calculateRentAudit(terms, saved),
        notes: notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'lease_id,start_month,end_month' },
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as SavedRentAudit
}

export async function deleteRentAudit(id: string) {
  const { error } = await db.from('rent_audits').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
