import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../lib/db'
import type { Lease } from '../lib/leases'
import { downloadCsv, reportRows, type ReportRow } from '../lib/reportRows'
import { formatDate, formatNumber, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { reports } from '../i18n/messages/reports'

type StatusFilter = '' | 'active' | 'expiring' | 'expired' | 'unknown'
type SortKey = 'tenant' | 'landlord' | 'start' | 'end' | 'rent'

const FILTER_KEYS = ['q', 'tenant', 'landlord', 'status', 'startFrom', 'endBy', 'minRent', 'maxRent'] as const

const DATE_OPTS: Intl.DateTimeFormatOptions = { timeZone: 'UTC', dateStyle: 'medium' }

/** A plain YYYY-MM-DD in the app's date format; anything else as written. */
const showDate = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(`${value}T00:00:00Z`, DATE_OPTS) : value

const money = (n: number) => formatNumber(n, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// Date inputs give YYYY-MM-DD, compared at local midnight like parsed abstract dates.
const inputDate = (value: string) => (value ? new Date(`${value}T00:00:00`) : null)

const compare = (a: ReportRow, b: ReportRow, key: SortKey): number => {
  const nullsLast = <T,>(x: T | null, y: T | null, cmp: (x: T, y: T) => number) =>
    x === null ? (y === null ? 0 : 1) : y === null ? -1 : cmp(x, y)
  switch (key) {
    case 'tenant':
    case 'landlord':
      return nullsLast(a[key] || null, b[key] || null, (x, y) => x.localeCompare(y))
    case 'start':
      return nullsLast(a.startDate, b.startDate, (x, y) => x.getTime() - y.getTime())
    case 'end':
      return nullsLast(a.end, b.end, (x, y) => x.getTime() - y.getTime())
    case 'rent':
      return nullsLast(a.monthlyRent, b.monthlyRent, (x, y) => x - y)
  }
}

export function Reports() {
  const { t, tp } = useT(reports)
  const { t: tc } = useT(common)
  const [leases, setLeases] = useState<Lease[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Filters live in the URL so a filtered report can be bookmarked or shared.
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'end', desc: false })

  useEffect(() => {
    db
      .from('leases')
      .select('*')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        setLeases((data as Lease[]) ?? [])
      })
  }, [])

  const get = (key: (typeof FILTER_KEYS)[number]) => params.get(key) ?? ''
  const set = (key: (typeof FILTER_KEYS)[number], value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  const hasFilters = FILTER_KEYS.some((k) => params.get(k))

  const rows = useMemo(() => (leases ? reportRows(leases) : []), [leases])
  const tenants = useMemo(() => [...new Set(rows.map((r) => r.tenant).filter(Boolean))].sort(), [rows])
  const landlords = useMemo(() => [...new Set(rows.map((r) => r.landlord).filter(Boolean))].sort(), [rows])

  const q = get('q').trim().toLowerCase()
  const tenant = get('tenant')
  const landlord = get('landlord')
  const status = get('status') as StatusFilter
  const startFrom = inputDate(get('startFrom'))
  const endBy = inputDate(get('endBy'))
  const minRent = get('minRent') ? Number(get('minRent')) : null
  const maxRent = get('maxRent') ? Number(get('maxRent')) : null

  const shown = useMemo(() => {
    const list = rows.filter((r) => {
      if (q && ![r.tenant, r.landlord, r.premises, r.lease.title].some((v) => v.toLowerCase().includes(q))) return false
      if (tenant && r.tenant !== tenant) return false
      if (landlord && r.landlord !== landlord) return false
      if (status === 'expiring' ? !r.expiringSoon : status && r.status !== status) return false
      if (startFrom && (!r.startDate || r.startDate < startFrom)) return false
      if (endBy && (!r.end || r.end > endBy)) return false
      if (minRent !== null && (r.monthlyRent === null || r.monthlyRent < minRent)) return false
      if (maxRent !== null && (r.monthlyRent === null || r.monthlyRent > maxRent)) return false
      return true
    })
    return list.sort((a, b) => (sort.desc ? -1 : 1) * compare(a, b, sort.key))
  }, [rows, q, tenant, landlord, status, startFrom?.getTime(), endBy?.getTime(), minRent, maxRent, sort])

  const totalMonthly = shown.reduce((n, r) => n + (r.monthlyRent ?? 0), 0)

  const statusLabel = (r: ReportRow) =>
    r.status === 'expired' ? t('statusExpired') : r.status === 'unknown' ? t('statusUnknown') : r.expiringSoon ? t('statusExpiring') : t('statusActive')

  const exportCsv = () => {
    const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')
    downloadCsv(`leaseiq-report-${iso(new Date())}.csv`, [
      [t('colLease'), t('colTenant'), t('colLandlord'), t('colPremises'), t('colStart'), t('colEnd'), t('colRent'), t('colMonthly'), t('colStatus')],
      ...shown.map((r) => [
        r.lease.title,
        r.tenant,
        r.landlord,
        r.premises,
        r.startDate ? iso(r.startDate) : r.start ?? '',
        iso(r.end),
        r.rent ?? '',
        r.monthlyRent !== null ? r.monthlyRent.toFixed(2) : '',
        statusLabel(r),
      ]),
    ])
  }

  const header = (key: SortKey, label: string, num = false) => (
    <th className={num ? 'num' : undefined} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        className="th-sort"
        title={t('sortBy', { column: label })}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}
      >
        {label}
        <span aria-hidden className="th-sort-arrow">{sort.key === key ? (sort.desc ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  )

  return (
    <main className="container wide">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>

      <section className="card report-filters">
        <label className="report-search">
          {t('search')}
          <input type="search" value={get('q')} placeholder={t('searchPlaceholder')} onChange={(e) => set('q', e.target.value)} />
        </label>
        <label>
          {t('tenant')}
          <select className="select" value={tenant} onChange={(e) => set('tenant', e.target.value)}>
            <option value="">{t('any')}</option>
            {tenants.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>
          {t('landlord')}
          <select className="select" value={landlord} onChange={(e) => set('landlord', e.target.value)}>
            <option value="">{t('any')}</option>
            {landlords.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>
          {t('status')}
          <select className="select" value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('any')}</option>
            <option value="active">{t('statusActive')}</option>
            <option value="expiring">{t('statusExpiring')}</option>
            <option value="expired">{t('statusExpired')}</option>
            <option value="unknown">{t('statusUnknown')}</option>
          </select>
        </label>
        <label>
          {t('startFrom')}
          <input type="date" value={get('startFrom')} onChange={(e) => set('startFrom', e.target.value)} />
        </label>
        <label>
          {t('endBy')}
          <input type="date" value={get('endBy')} onChange={(e) => set('endBy', e.target.value)} />
        </label>
        <label>
          {t('minRent')}
          <input type="number" min={0} step={100} inputMode="numeric" value={get('minRent')} onChange={(e) => set('minRent', e.target.value)} />
        </label>
        <label>
          {t('maxRent')}
          <input type="number" min={0} step={100} inputMode="numeric" value={get('maxRent')} onChange={(e) => set('maxRent', e.target.value)} />
        </label>
      </section>

      <div className="section-header">
        <h2>
          {hasFilters && leases ? t('countOf', { shown: tp('count', shown.length), total: formatNumber(rows.length) }) : tp('count', shown.length)}
        </h2>
        <div className="section-actions">
          {shown.length > 0 && <span className="muted small">{t('totalRent', { amount: money(totalMonthly) })}</span>}
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>{t('clear')}</button>
          )}
          <button className="btn btn-sm" onClick={exportCsv} disabled={!shown.length}>{t('exportCsv')}</button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!leases ? (
        <p className="muted">{tc('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{t('noLeases')}</p>
      ) : shown.length === 0 ? (
        <p className="muted">{t('noMatches')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table report-table">
            <thead>
              <tr>
                {header('tenant', t('colTenant'))}
                {header('landlord', t('colLandlord'))}
                {header('start', t('colStart'))}
                {header('end', t('colEnd'))}
                {header('rent', t('colRent'))}
                <th>{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.lease.id}>
                  <td>
                    <Link to={`/leases/${r.lease.id}/overview`} className="panel-link">{r.tenant || '—'}</Link>
                    {r.premises && <div className="muted small">{r.premises}</div>}
                  </td>
                  <td>{r.landlord || '—'}</td>
                  <td className="nowrap">{showDate(r.start) ?? '—'}</td>
                  <td className="nowrap">{r.end ? formatDate(r.end, { dateStyle: 'medium' }) : '—'}</td>
                  <td title={r.rentText ?? undefined}>
                    {r.rent ?? '—'}
                    {r.monthlyRent !== null && !/\/\s*mo|month/i.test(r.rent ?? '') && (
                      <div className="muted small">{t('perMonth', { amount: money(r.monthlyRent) })}</div>
                    )}
                  </td>
                  <td>
                    <span className={`ov-status ov-status-${r.status} report-status`}>
                      <span className="ov-status-dot" aria-hidden />
                      {statusLabel(r)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

