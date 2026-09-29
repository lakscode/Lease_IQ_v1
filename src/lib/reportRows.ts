import type { Lease } from './leases'
import { leaseTerms, parseDate, type LeaseTerm } from './leaseStatus'

/** One main lease on the Reports page, with its terms as amended. */
export type ReportRow = {
  lease: Lease
  tenant: string
  landlord: string
  premises: string
  /** Start date as written (commencement, else the effective date). */
  start: string | null
  startDate: Date | null
  end: Date | null
  status: LeaseTerm['status']
  expiringSoon: boolean
  /** Current rent as written, e.g. "$3,100/mo". */
  rent: string | null
  /** Current rent per month, when an amount could be read. */
  monthlyRent: number | null
  /** Full base rent text, from the latest document that states it. */
  rentText: string | null
}

/** Each abstract value from the latest document that states it (later documents override earlier ones). */
const latestValue = (family: Lease[], key: string) =>
  [...family].reverse().find((doc) => doc.abstract?.[key]?.trim())?.abstract[key] ?? null

const byDate = (a: Lease, b: Lease) => (a.effective_date ?? '').localeCompare(b.effective_date ?? '') || a.page_start - b.page_start

const amount = (s: string) => Number(s.replace(/[^\d.]/g, ''))

/**
 * The rent in force today. Base rent is written as a schedule, e.g.
 * "Aug 1, 2025-Jul 31, 2026: $37,200/yr ($3,100/mo); Aug 1, 2026-…". The period
 * containing today wins; before the first period, the first; after the last, the last.
 */
export function currentRent(text: string | null, today = new Date()): { rent: string | null; monthly: number | null } {
  if (!text?.trim()) return { rent: null, monthly: null }
  const periods = text
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.+?)\s*(?:[-–—]|\bto\b|\bthrough\b)\s*(.+?):\s*(.+)$/i)
      return m ? { from: parseDate(m[1]), to: parseDate(m[2]), value: m[3] } : { from: null, to: null, value: s }
    })
    .filter((p) => /\$\s?[\d,]/.test(p.value))
  if (!periods.length) return { rent: text.length > 40 ? null : text, monthly: null }

  const dated = periods.filter((p) => p.from && p.to)
  const pick =
    dated.find((p) => p.from! <= today && today <= p.to!) ??
    (dated.length && today < dated[0].from! ? dated[0] : dated.length ? dated[dated.length - 1] : periods[0])

  const value = pick.value.trim()
  const monthly = value.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/|per\s+)\s*(?:mo|month)/i)
  const yearly = value.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/|per\s+)\s*(?:yr|year|annum)/i)
  const any = value.match(/\$\s?([\d,]+(?:\.\d+)?)/)
  return {
    rent: value,
    monthly: monthly ? amount(monthly[1]) : yearly ? amount(yearly[1]) / 12 : any ? amount(any[1]) : null,
  }
}

export function reportRows(leases: Lease[]): ReportRow[] {
  return leaseTerms(leases).map((term) => {
    const main = term.main
    const family = [main, ...leases.filter((l) => l.parent_id === main.id).sort(byDate)]
    const a = main.abstract ?? {}
    const start = latestValue(family, 'commencement_date') ?? main.effective_date
    const rentText = latestValue(family, 'base_rent')
    const { rent, monthly } = currentRent(rentText)
    return {
      lease: main,
      tenant: main.tenant ?? a.tenant ?? '',
      landlord: main.landlord ?? a.landlord ?? '',
      premises: main.premises ?? a.premises_address ?? '',
      start,
      startDate: parseDate(start),
      end: term.expiration,
      status: term.status,
      expiringSoon: term.expiringSoon,
      rent,
      monthlyRent: monthly,
      rentText,
    }
  })
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function downloadCsv(fileName: string, rows: string[][]) {
  // BOM so Excel reads the file as UTF-8.
  const text = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
