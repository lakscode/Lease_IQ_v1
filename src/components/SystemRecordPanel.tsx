import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Lease } from '../lib/leases'
import { parseDate } from '../lib/leaseStatus'
import { fetchSystemLease, SOURCE_LABELS, type SavedSystemLease } from '../lib/imports'
import { formatDate, formatNumber, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { systemRecord } from '../i18n/messages/systemRecord'

type Status = 'match' | 'mismatch' | 'check'
type Row = { label: string; lease: string | null; system: string | null; status: Status | null }

const usd = (n: number | null) => (n === null ? null : formatNumber(n, { style: 'currency', currency: 'USD' }))

/** First amount in free text, e.g. "$4,500 per month" -> 4500. */
function amount(text: string | null | undefined): number | null {
  const m = text?.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/** Monthly base rent from abstract text, when it says whether the amount is monthly or annual. */
function monthlyRent(text: string | null | undefined): number | null {
  const n = amount(text)
  if (n === null || !text) return null
  if (/per\s+month|monthly|\/\s*mo|a month/i.test(text)) return n
  if (/per\s+(year|annum)|annual|\/\s*y(ea)?r|a year/i.test(text)) return Math.round((n / 12) * 100) / 100
  return null
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01)

function compareNumbers(label: string, leaseText: string | null, leaseValue: number | null, system: number | null, format = usd): Row {
  const status: Status | null =
    leaseValue !== null && system !== null ? (close(leaseValue, system) ? 'match' : 'mismatch') : leaseText || system !== null ? 'check' : null
  return { label, lease: leaseText, system: format(system), status }
}

function compareDates(label: string, leaseText: string | null, system: string | null): Row {
  // ISO text is compared as is; other formats ("July 31, 2029") parse to local midnight.
  const leaseDate = parseDate(leaseText)
  const leaseIso = leaseText?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ??
    (leaseDate
      ? `${leaseDate.getFullYear()}-${String(leaseDate.getMonth() + 1).padStart(2, '0')}-${String(leaseDate.getDate()).padStart(2, '0')}`
      : null)
  const status: Status | null = leaseIso && system ? (leaseIso === system ? 'match' : 'mismatch') : leaseText || system ? 'check' : null
  return { label, lease: leaseText, system, status }
}

/** The imported system record for this lease family, compared with the lease terms as amended. */
export function SystemRecordPanel({ family }: { family: Lease[] }) {
  const { t, tp } = useT(systemRecord)
  const { t: tc } = useT(common)
  const [record, setRecord] = useState<SavedSystemLease | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const ids = family.map((l) => l.id).join(',')

  useEffect(() => {
    fetchSystemLease(ids ? ids.split(',') : []).then(setRecord, (e) => setError(e.message))
  }, [ids])

  if (error) return <p className="error small">{t('loadError', { error })}</p>
  if (record === undefined) return <p className="muted small">{tc('loading')}</p>
  if (!record) {
    return (
      <p className="muted panel-empty">
        {t('noRecord')}{' '}
        {t('importPrompt')
          .split(/(\{link\})/)
          .map((part, i) =>
            part === '{link}' ? (
              <Link key={i} to="/import" className="link">{t('importLink')}</Link>
            ) : (
              part
            ),
          )}
      </p>
    )
  }

  // Latest stated value across the family: amendments come after the main lease.
  const latest = (field: string) => {
    for (const doc of [...family].reverse()) {
      const v = doc.abstract?.[field]
      if (v) return v
    }
    return null
  }
  const main = family[0]
  const tenant = main.tenant ?? main.abstract?.tenant ?? null
  const rentText = latest('base_rent')
  const depositText = latest('security_deposit')
  const areaText = latest('rentable_area')

  const rows: Row[] = [
    { label: t('tenant'), lease: tenant, system: record.tenant, status: null },
    compareDates(t('leaseStart'), latest('commencement_date'), record.lease_start),
    compareDates(t('leaseEnd'), latest('expiration_date'), record.lease_end),
    compareNumbers(t('area'), areaText, amount(areaText), record.area_sqft, (n) => (n === null ? null : formatNumber(n))),
    compareNumbers(t('baseRentMonth'), rentText, monthlyRent(rentText), record.monthly_base_rent),
    compareNumbers(t('securityDeposit'), depositText, amount(depositText), record.security_deposit),
  ]
  const charges: Array<[string, number | null]> = [
    [t('camMonth'), record.cam_monthly],
    [t('taxMonth'), record.tax_monthly],
    [t('insuranceMonth'), record.insurance_monthly],
    [t('otherMonth'), record.other_monthly],
  ]
  const mismatches = rows.filter((r) => r.status === 'mismatch').length

  return (
    <>
      <p className="muted small system-source">
        {SOURCE_LABELS[record.source]} · {[record.property, record.unit].filter(Boolean).join(' · ')}
        {record.external_id && ` · ${record.external_id}`} · {t('imported', { date: formatDate(record.created_at) })}
        {mismatches > 0 && <span className="system-mismatch-count"> · {tp('mismatches', mismatches)}</span>}
      </p>
      <table className="panel-table">
        <thead>
          <tr>
            <th />
            <th>{t('colLease')}</th>
            <th>{t('colSystem')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.status === 'mismatch' ? 'system-mismatch' : undefined}>
              <td className="panel-label">{r.label}</td>
              <td>
                <div className="panel-value" title={r.lease ?? undefined}>{r.lease ?? <span className="muted">—</span>}</div>
              </td>
              <td className="nowrap">{r.system ?? <span className="muted">—</span>}</td>
              <td className="panel-num">
                {r.status === 'match' && <span className="system-ok" title={t('matchesTitle')}>✓</span>}
                {r.status === 'mismatch' && <span className="badge badge-error">{t('mismatch')}</span>}
                {r.status === 'check' && <span className="muted small" title={t('checkTitle')}>{t('check')}</span>}
              </td>
            </tr>
          ))}
          {charges.map(([label, value]) => (
            <tr key={label}>
              <td className="panel-label">{label}</td>
              <td className="muted small">{t('billedCharge')}</td>
              <td className="nowrap">{usd(value) ?? <span className="muted">—</span>}</td>
              <td />
            </tr>
          ))}
          {record.next_escalation_date && (
            <tr>
              <td className="panel-label">{t('nextIncrease')}</td>
              <td className="muted small">{t('inSystem')}</td>
              <td className="nowrap">
                {record.next_escalation_date}
                {record.next_escalation_rent !== null && ` → ${usd(record.next_escalation_rent)}`}
              </td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
