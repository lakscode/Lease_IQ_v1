import { supabase } from './supabase'

/** CAM reconciliation terms extracted from the lease family (lease_insights.cam). -1 means not stated. */
export type CamTerms = {
  has_cam: boolean
  pro_rata_share_percent: number
  share_basis: string
  recoverable_items: string
  exclusions: string
  admin_fee_percent: number
  admin_fee_basis: 'tenant_share' | 'total_expenses' | 'not_stated'
  cap_percent: number
  cap_type: 'none' | 'non_cumulative' | 'cumulative' | 'not_stated'
  cap_applies_to: 'all' | 'controllable' | 'not_stated'
  cap_terms: string
  gross_up_percent: number
  base_year: string
  expense_year: string
  estimate_payments: string
  reconciliation_deadline: string
  reconciliation_deadline_days: number
  audit_rights: string
  citations: Array<{ leaseId: string; title: string; page: number }>
}

/** What the user enters for one year. Blank optional amounts are null. */
export type CamInputs = {
  totalExpenses: number | null
  excludedExpenses: number | null
  variableExpenses: number | null
  occupancyPercent: number | null
  controllableExpenses: number | null
  baseYearExpenses: number | null
  priorYearCapBase: number | null
  estimatesPaid: number | null
  proRataPercent: number | null
  adminFeePercent: number | null
  grossUpPercent: number | null
  capPercent: number | null
  capAppliesTo: 'all' | 'controllable'
}

export type CamResult = {
  recoverable: number
  grossUpAdjustment: number
  adjusted: number
  baseYearDeduction: number
  tenantShare: number
  adminFee: number
  subtotal: number
  capLimit: number | null
  capReduction: number
  totalDue: number
  estimatesPaid: number
  balance: number
}

export type CamReconciliation = {
  id: string
  lease_id: string
  year: number
  inputs: CamInputs
  result: CamResult
  notes: string | null
  updated_at: string
}

const known = (n: number | undefined | null) => (n !== undefined && n !== null && n >= 0 ? n : null)

/** Calculator inputs pre-filled with the rates from the lease. */
export function defaultInputs(terms: CamTerms | null): CamInputs {
  return {
    totalExpenses: null,
    excludedExpenses: null,
    variableExpenses: null,
    occupancyPercent: null,
    controllableExpenses: null,
    baseYearExpenses: null,
    priorYearCapBase: null,
    estimatesPaid: null,
    proRataPercent: known(terms?.pro_rata_share_percent),
    adminFeePercent: known(terms?.admin_fee_percent),
    grossUpPercent: known(terms?.gross_up_percent),
    capPercent: known(terms?.cap_percent),
    capAppliesTo: terms?.cap_applies_to === 'controllable' ? 'controllable' : 'all',
  }
}

/**
 * Standard CAM reconciliation:
 * 1. Recoverable = total operating expenses − excluded expenses.
 * 2. Gross-up: when occupancy was below the gross-up level, variable expenses
 *    are scaled up to that level.
 * 3. Base year / expense stop: the tenant pays only the increase over it.
 * 4. Tenant share = pro-rata % of the result, plus the admin fee on that share.
 * 5. Cap: the capped charge is at most the prior-year base × (1 + cap %);
 *    for caps on controllable expenses only, the controllable part of the
 *    charge (in proportion to controllable expenses) is capped.
 * 6. Balance = total due − estimates paid (positive: tenant owes; negative: credit).
 */
export function calculateCam(i: CamInputs): CamResult {
  const n = (v: number | null) => v ?? 0
  const recoverable = Math.max(n(i.totalExpenses) - n(i.excludedExpenses), 0)

  let grossUpAdjustment = 0
  const occupancy = n(i.occupancyPercent)
  const grossUp = n(i.grossUpPercent)
  if (grossUp > 0 && occupancy > 0 && occupancy < grossUp && n(i.variableExpenses) > 0) {
    grossUpAdjustment = n(i.variableExpenses) * (grossUp / occupancy) - n(i.variableExpenses)
  }
  const adjusted = recoverable + grossUpAdjustment

  const baseYearDeduction = i.baseYearExpenses !== null ? Math.min(i.baseYearExpenses, adjusted) : 0
  const tenantShare = (adjusted - baseYearDeduction) * (n(i.proRataPercent) / 100)
  const adminFee = tenantShare * (n(i.adminFeePercent) / 100)
  const subtotal = tenantShare + adminFee

  let totalDue = subtotal
  let capLimit: number | null = null
  if (n(i.capPercent) > 0 && n(i.priorYearCapBase) > 0) {
    capLimit = n(i.priorYearCapBase) * (1 + n(i.capPercent) / 100)
    if (i.capAppliesTo === 'controllable' && n(i.controllableExpenses) > 0 && adjusted > 0) {
      const controllablePart = subtotal * Math.min(n(i.controllableExpenses) / adjusted, 1)
      totalDue = subtotal - controllablePart + Math.min(controllablePart, capLimit)
    } else {
      totalDue = Math.min(subtotal, capLimit)
    }
  }

  const estimatesPaid = n(i.estimatesPaid)
  return {
    recoverable,
    grossUpAdjustment,
    adjusted,
    baseYearDeduction,
    tenantShare,
    adminFee,
    subtotal,
    capLimit,
    capReduction: subtotal - totalDue,
    totalDue,
    estimatesPaid,
    balance: totalDue - estimatesPaid,
  }
}

/** The date the landlord's statement is due, when the lease gives a number of days after a calendar year. */
export function statementDeadline(terms: CamTerms | null, year: number): Date | null {
  if (!terms || terms.reconciliation_deadline_days <= 0) return null
  if (terms.expense_year && !/calendar/i.test(terms.expense_year)) return null
  const d = new Date(year, 11, 31)
  d.setDate(d.getDate() + terms.reconciliation_deadline_days)
  return d
}

export const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export async function listReconciliations(familyId: string): Promise<CamReconciliation[]> {
  const { data, error } = await supabase
    .from('cam_reconciliations')
    .select('*')
    .eq('lease_id', familyId)
    .order('year', { ascending: false })
  if (error) throw new Error(error.message)
  return data as CamReconciliation[]
}

/** Saves the year's reconciliation, replacing any earlier one for the same year. */
export async function saveReconciliation(familyId: string, year: number, inputs: CamInputs, notes: string) {
  const { data, error } = await supabase
    .from('cam_reconciliations')
    .upsert(
      { lease_id: familyId, year, inputs, result: calculateCam(inputs), notes: notes || null, updated_at: new Date().toISOString() },
      { onConflict: 'lease_id,year' },
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as CamReconciliation
}

export async function deleteReconciliation(id: string) {
  const { error } = await supabase.from('cam_reconciliations').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
