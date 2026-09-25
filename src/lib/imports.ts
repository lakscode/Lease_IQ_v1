import { supabase } from './supabase'
import type { Lease } from './leases'

export type ImportSource = 'yardi' | 'mri' | 'csv'

export type FieldKey =
  | 'external_id'
  | 'property'
  | 'unit'
  | 'tenant'
  | 'status'
  | 'lease_start'
  | 'lease_end'
  | 'area_sqft'
  | 'monthly_base_rent'
  | 'annual_base_rent'
  | 'cam_monthly'
  | 'tax_monthly'
  | 'insurance_monthly'
  | 'other_monthly'
  | 'security_deposit'
  | 'next_escalation_date'
  | 'next_escalation_rent'
  | 'charge_code'
  | 'charge_amount'

type FieldType = 'text' | 'date' | 'number'

export type ImportField = {
  key: FieldKey
  label: string
  type: FieldType
  required?: boolean
  description: string
  // Column headings used by each source; matched ignoring case, spaces and punctuation.
  aliases: Record<ImportSource, string[]>
  // Template column heading and sample values for the CSV template.
  template?: { heading: string; samples: [string, string] }
}

const common = {
  external_id: ['lease id', 'lease code', 'tenant code', 'tenant id', 'occupant id'],
  property: ['property', 'property code', 'property name', 'building', 'bldg'],
  unit: ['unit', 'units', 'suite', 'space', 'unit id'],
  tenant: ['tenant', 'tenant name', 'lease name', 'occupant', 'occupant name', 'lessee'],
}

export const IMPORT_FIELDS: ImportField[] = [
  {
    key: 'tenant',
    label: 'Tenant',
    type: 'text',
    required: true,
    description: 'Tenant or lease name. Used to match the record to a lease in LeaseIQ.',
    aliases: { yardi: ['lease', 'lease name', ...common.tenant], mri: ['occupant name', 'tenant name', 'dba name', ...common.tenant], csv: common.tenant },
    template: { heading: 'Tenant', samples: ['NexGen Solutions', 'Acme Corp'] },
  },
  {
    key: 'external_id',
    label: 'Lease ID',
    type: 'text',
    description: 'The lease or tenant code in your system.',
    aliases: { yardi: ['tenant code', 'lease code', 'tcode', ...common.external_id], mri: ['lease id', 'lease number', 'leasid', ...common.external_id], csv: common.external_id },
    template: { heading: 'Lease ID', samples: ['t0001234', 't0005678'] },
  },
  {
    key: 'property',
    label: 'Property',
    type: 'text',
    description: 'Property or building code/name.',
    aliases: { yardi: ['property', 'property code', ...common.property], mri: ['bldg id', 'building id', 'bldgid', 'entity id', ...common.property], csv: common.property },
    template: { heading: 'Property', samples: ['650MAPLE', '1200MAIN'] },
  },
  {
    key: 'unit',
    label: 'Unit / suite',
    type: 'text',
    description: 'Unit or suite number. Also helps matching.',
    aliases: { yardi: ['unit(s)', 'units', ...common.unit], mri: ['suite id', 'suite', 'suitid', ...common.unit], csv: common.unit },
    template: { heading: 'Unit', samples: ['400', '120'] },
  },
  {
    key: 'status',
    label: 'Status',
    type: 'text',
    description: 'Lease status (current, future, past, month-to-month).',
    aliases: { yardi: ['status', 'lease status', 'lease type'], mri: ['status', 'lease status', 'occupancy status'], csv: ['status', 'lease status'] },
    template: { heading: 'Status', samples: ['Current', 'Current'] },
  },
  {
    key: 'lease_start',
    label: 'Lease start',
    type: 'date',
    description: 'Lease start / commencement date.',
    aliases: { yardi: ['lease from', 'from', 'lease start', 'start date', 'commencement'], mri: ['lease start', 'occupancy date', 'begin date', 'commencement date', 'rent start'], csv: ['lease start', 'start date', 'commencement date', 'commencement'] },
    template: { heading: 'Lease Start', samples: ['2025-08-01', '2022-01-01'] },
  },
  {
    key: 'lease_end',
    label: 'Lease end',
    type: 'date',
    description: 'Lease expiration date as currently in your system.',
    aliases: { yardi: ['lease to', 'to', 'lease end', 'expiration', 'end date'], mri: ['lease stop', 'expiration date', 'stop date', 'lease expiration', 'vacate date'], csv: ['lease end', 'end date', 'expiration date', 'expiration'] },
    template: { heading: 'Lease End', samples: ['2029-07-31', '2026-12-31'] },
  },
  {
    key: 'area_sqft',
    label: 'Area (sq ft)',
    type: 'number',
    description: 'Leased area in square feet.',
    aliases: { yardi: ['area', 'sq ft', 'sqft', 'unit area', 'rentable area'], mri: ['suite sq ft', 'sq ft', 'gla', 'rentable sq ft', 'rsf', 'area'], csv: ['area', 'area sq ft', 'sq ft', 'sqft', 'rsf', 'rentable area'] },
    template: { heading: 'Area Sq Ft', samples: ['1800', '3200'] },
  },
  {
    key: 'monthly_base_rent',
    label: 'Monthly base rent',
    type: 'number',
    description: 'Current monthly base rent. Give this or the annual base rent.',
    aliases: { yardi: ['monthly rent', 'current rent', 'base rent', 'rent monthly'], mri: ['monthly base rent', 'monthly rent', 'current monthly rent', 'base rent'], csv: ['monthly base rent', 'monthly rent', 'base rent'] },
    template: { heading: 'Monthly Base Rent', samples: ['4500.00', '8000.00'] },
  },
  {
    key: 'annual_base_rent',
    label: 'Annual base rent',
    type: 'number',
    description: 'Current annual base rent (converted to monthly when there is no monthly column).',
    aliases: { yardi: ['annual rent', 'annual base rent'], mri: ['annual rent', 'annual base rent', 'annualized rent'], csv: ['annual base rent', 'annual rent'] },
  },
  {
    key: 'cam_monthly',
    label: 'CAM (monthly)',
    type: 'number',
    description: 'Monthly CAM / operating expense estimate billed.',
    aliases: { yardi: ['cam', 'cam monthly', 'opex', 'recoveries'], mri: ['cam', 'cam monthly', 'opex', 'operating expenses', 'recoveries'], csv: ['cam monthly', 'cam', 'opex monthly'] },
    template: { heading: 'CAM Monthly', samples: ['600.00', '1100.00'] },
  },
  {
    key: 'tax_monthly',
    label: 'Tax (monthly)',
    type: 'number',
    description: 'Monthly real estate tax recovery billed.',
    aliases: { yardi: ['tax', 'ret', 'real estate tax'], mri: ['ret', 'tax', 'real estate tax'], csv: ['tax monthly', 'tax', 'real estate tax'] },
    template: { heading: 'Tax Monthly', samples: ['250.00', '400.00'] },
  },
  {
    key: 'insurance_monthly',
    label: 'Insurance (monthly)',
    type: 'number',
    description: 'Monthly insurance recovery billed.',
    aliases: { yardi: ['insurance', 'ins'], mri: ['ins', 'insurance'], csv: ['insurance monthly', 'insurance'] },
    template: { heading: 'Insurance Monthly', samples: ['90.00', '150.00'] },
  },
  {
    key: 'other_monthly',
    label: 'Other charges (monthly)',
    type: 'number',
    description: 'Any other recurring monthly charges (parking, storage, utilities).',
    aliases: { yardi: ['other', 'misc', 'other charges'], mri: ['other', 'misc', 'other charges'], csv: ['other monthly', 'other charges'] },
    template: { heading: 'Other Monthly', samples: ['0.00', '75.00'] },
  },
  {
    key: 'security_deposit',
    label: 'Security deposit',
    type: 'number',
    description: 'Security deposit held.',
    aliases: { yardi: ['security deposit', 'security deposit received', 'deposit', 'sec dep'], mri: ['security deposit', 'deposit', 'sec dep', 'deposit amount'], csv: ['security deposit', 'deposit'] },
    template: { heading: 'Security Deposit', samples: ['9000.00', '16000.00'] },
  },
  {
    key: 'next_escalation_date',
    label: 'Next increase date',
    type: 'date',
    description: 'Date of the next scheduled rent increase in your system.',
    aliases: { yardi: ['next increase date', 'future rent date', 'step date'], mri: ['next step date', 'next increase date', 'future rent date'], csv: ['next increase date', 'next escalation date'] },
    template: { heading: 'Next Increase Date', samples: ['2026-08-01', '2025-01-01'] },
  },
  {
    key: 'next_escalation_rent',
    label: 'Next monthly rent',
    type: 'number',
    description: 'Monthly base rent after the next increase.',
    aliases: { yardi: ['future rent', 'next rent', 'future monthly rent'], mri: ['next step amount', 'future rent', 'next monthly rent'], csv: ['next monthly rent', 'next rent'] },
    template: { heading: 'Next Monthly Rent', samples: ['4635.00', '8240.00'] },
  },
  {
    key: 'charge_code',
    label: 'Charge code',
    type: 'text',
    description: 'Only for reports that list each charge on its own row (e.g. rnt, cam, tax, ins).',
    aliases: { yardi: ['charge code', 'charge', 'chg code'], mri: ['income category', 'inccat', 'charge code'], csv: ['charge code'] },
  },
  {
    key: 'charge_amount',
    label: 'Charge amount (monthly)',
    type: 'number',
    description: 'Monthly amount of the charge on that row.',
    aliases: { yardi: ['amount', 'charge amount', 'monthly amount'], mri: ['amount', 'monthly amount', 'charge amount'], csv: ['charge amount'] },
  },
]

export const SOURCE_LABELS: Record<ImportSource, string> = { yardi: 'Yardi', mri: 'MRI', csv: 'CSV' }

// ---------- CSV ----------

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Sample CSV with one column per field that has a template heading. */
export function csvTemplate(): string {
  const fields = IMPORT_FIELDS.filter((f) => f.template)
  const lines = [
    fields.map((f) => f.template!.heading),
    fields.map((f) => f.template!.samples[0]),
    fields.map((f) => f.template!.samples[1]),
  ]
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function downloadCsvTemplate() {
  const url = URL.createObjectURL(new Blob([csvTemplate()], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'leaseiq-rent-roll-template.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ---------- Mapping and parsing ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export type ColumnMap = Partial<Record<FieldKey, number>>

/**
 * Finds the header row (the first row naming a tenant column, within the first
 * 15 rows, since system reports often start with titles) and maps each field
 * to a column by the source's aliases.
 */
export function detectColumns(rows: string[][], source: ImportSource): { headerRow: number; map: ColumnMap } {
  const tenantAliases = new Set([...IMPORT_FIELDS[0].aliases[source], ...IMPORT_FIELDS[0].aliases.csv].map(norm))
  let headerRow = rows.slice(0, 15).findIndex((r) => r.some((c) => tenantAliases.has(norm(c))))
  if (headerRow < 0) headerRow = 0
  const headers = rows[headerRow].map(norm)
  const map: ColumnMap = {}
  const used = new Set<number>()
  for (const field of IMPORT_FIELDS) {
    const aliases = [...field.aliases[source], ...field.aliases.csv, field.template?.heading ?? '', field.label].filter(Boolean).map(norm)
    const index = headers.findIndex((h, i) => !used.has(i) && aliases.includes(h))
    if (index >= 0) {
      map[field.key] = index
      used.add(index)
    }
  }
  return { headerRow, map }
}

function parseNumber(v: string | undefined): number | null {
  if (!v) return null
  const s = v.trim()
  if (!s) return null
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-')
  const n = Number(s.replace(/[^0-9.]/g, ''))
  if (!s.match(/\d/) || Number.isNaN(n)) return null
  return negative ? -n : n
}

function parseDate(v: string | undefined): string | null {
  if (!v?.trim()) return null
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/) // US style: M/D/YYYY, as Yardi and MRI export
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function iso(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export type SystemRecord = {
  external_id: string | null
  property: string | null
  unit: string | null
  tenant: string
  status: string | null
  lease_start: string | null
  lease_end: string | null
  area_sqft: number | null
  monthly_base_rent: number | null
  cam_monthly: number | null
  tax_monthly: number | null
  insurance_monthly: number | null
  other_monthly: number | null
  security_deposit: number | null
  next_escalation_date: string | null
  next_escalation_rent: number | null
  raw: Record<string, string>[]
}

// Charge codes on per-charge rows, by the category they add to.
function chargeCategory(code: string): 'monthly_base_rent' | 'cam_monthly' | 'tax_monthly' | 'insurance_monthly' | 'other_monthly' {
  const c = code.toLowerCase()
  if (/cam|opex|oex|op ?ex|common/.test(c)) return 'cam_monthly'
  if (/tax|ret/.test(c)) return 'tax_monthly'
  if (/ins/.test(c)) return 'insurance_monthly'
  if (/rnt|rent|base|bsr/.test(c)) return 'monthly_base_rent'
  return 'other_monthly'
}

/**
 * Turns the data rows into one record per lease. Reports that list each charge
 * on its own row (charge code + amount) are combined per lease, and rows that
 * only continue the previous lease (blank tenant) are folded into it.
 */
export function toRecords(rows: string[][], headerRow: number, map: ColumnMap): SystemRecord[] {
  const headers = rows[headerRow]
  const get = (row: string[], key: FieldKey) => (map[key] !== undefined ? row[map[key]!]?.trim() ?? '' : '')
  const byLease = new Map<string, SystemRecord>()
  let last: SystemRecord | null = null

  for (const row of rows.slice(headerRow + 1)) {
    const raw = Object.fromEntries(headers.map((h, i) => [h || `Column ${i + 1}`, row[i] ?? '']))
    const tenant = get(row, 'tenant')
    const chargeAmount = parseNumber(get(row, 'charge_amount'))
    const chargeCode = get(row, 'charge_code')

    // Totals and subtotal lines in system reports.
    if (/^(grand )?total|^subtotal/i.test(tenant) || /^(grand )?total/i.test(get(row, 'property'))) continue

    let record: SystemRecord | null = null
    if (tenant) {
      const key = `${get(row, 'external_id') || tenant}|${get(row, 'unit')}`.toLowerCase()
      record = byLease.get(key) ?? null
      if (!record) {
        const monthly = parseNumber(get(row, 'monthly_base_rent'))
        const annual = parseNumber(get(row, 'annual_base_rent'))
        record = {
          external_id: get(row, 'external_id') || null,
          property: get(row, 'property') || null,
          unit: get(row, 'unit') || null,
          tenant,
          status: get(row, 'status') || null,
          lease_start: parseDate(get(row, 'lease_start')),
          lease_end: parseDate(get(row, 'lease_end')),
          area_sqft: parseNumber(get(row, 'area_sqft')),
          monthly_base_rent: monthly ?? (annual !== null ? Math.round((annual / 12) * 100) / 100 : null),
          cam_monthly: parseNumber(get(row, 'cam_monthly')),
          tax_monthly: parseNumber(get(row, 'tax_monthly')),
          insurance_monthly: parseNumber(get(row, 'insurance_monthly')),
          other_monthly: parseNumber(get(row, 'other_monthly')),
          security_deposit: parseNumber(get(row, 'security_deposit')),
          next_escalation_date: parseDate(get(row, 'next_escalation_date')),
          next_escalation_rent: parseNumber(get(row, 'next_escalation_rent')),
          raw: [],
        }
        byLease.set(key, record)
      }
    } else if (last && chargeCode) {
      record = last
    }
    if (!record) continue
    record.raw.push(raw)
    if (chargeCode && chargeAmount !== null) {
      const field = chargeCategory(chargeCode)
      record[field] = (record[field] ?? 0) + chargeAmount
    }
    last = record
  }
  return [...byLease.values()]
}

// ---------- Matching ----------

const STOP_WORDS = new Set(['inc', 'llc', 'ltd', 'lp', 'llp', 'corp', 'corporation', 'co', 'company', 'the', 'dba', 'of', 'and', 'group', 'limited'])
const tokens = (s: string | null | undefined) => new Set(norm(s ?? '').split(' ').filter((t) => t && !STOP_WORDS.has(t)))

/** Best main lease for a record by tenant name, with a boost when the unit appears in the premises. */
export function matchLease(record: SystemRecord, leases: Lease[]): Lease | null {
  const recordTokens = tokens(record.tenant)
  if (!recordTokens.size) return null
  let best: { lease: Lease; score: number } | null = null
  for (const lease of leases) {
    const leaseTokens = tokens(lease.tenant ?? lease.abstract?.tenant ?? lease.title)
    if (!leaseTokens.size) continue
    const shared = [...recordTokens].filter((t) => leaseTokens.has(t)).length
    let score = shared / Math.min(recordTokens.size, leaseTokens.size)
    const premises = norm(lease.premises ?? lease.abstract?.premises_address ?? '')
    if (record.unit && premises && new RegExp(`\\b${norm(record.unit)}\\b`).test(premises)) score += 0.25
    if (lease.doc_type === 'main_lease') score += 0.05
    if (!best || score > best.score) best = { lease, score }
  }
  return best && best.score >= 0.6 ? best.lease : null
}

// ---------- Saving ----------

export type DataImport = {
  id: string
  source: ImportSource
  file_name: string
  row_count: number
  matched_count: number
  created_at: string
}

export type SavedSystemLease = Omit<SystemRecord, 'raw'> & {
  id: string
  import_id: string
  source: ImportSource
  matched_lease_id: string | null
  created_at: string
}

export async function saveImport(
  source: ImportSource,
  fileName: string,
  columnMap: Record<string, string>,
  records: Array<SystemRecord & { matched_lease_id: string | null }>,
): Promise<DataImport> {
  const { data: imp, error } = await supabase
    .from('data_imports')
    .insert({
      source,
      file_name: fileName,
      row_count: records.length,
      matched_count: records.filter((r) => r.matched_lease_id).length,
      column_map: columnMap,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  for (let i = 0; i < records.length; i += 200) {
    const batch = records.slice(i, i + 200).map((r) => ({ ...r, import_id: imp.id, source }))
    const { error: rowsError } = await supabase.from('system_leases').insert(batch)
    if (rowsError) {
      await supabase.from('data_imports').delete().eq('id', imp.id)
      throw new Error(`Saving rows failed: ${rowsError.message}`)
    }
  }
  return imp as DataImport
}

export async function listImports(): Promise<DataImport[]> {
  const { data, error } = await supabase.from('data_imports').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as DataImport[]
}

export async function deleteImport(id: string) {
  const { error } = await supabase.from('data_imports').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** The latest imported system record matched to any document of the lease family. */
export async function fetchSystemLease(familyIds: string[]): Promise<SavedSystemLease | null> {
  if (!familyIds.length) return null
  const { data, error } = await supabase
    .from('system_leases')
    .select('*')
    .in('matched_lease_id', familyIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as SavedSystemLease | null
}
