import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Lease } from '../lib/leases'
import { daysFromToday, leaseTerms, type LeaseTerm } from '../lib/leaseStatus'
import { formatDate, formatNumber, useT } from '../i18n'
import { dashboard } from '../i18n/messages/dashboard'
import { common } from '../i18n/messages/common'

const QUARTERS = 8
// Days left at or under which an expiring lease is flagged urgent / soon.
const URGENT_DAYS = 90
const SOON_DAYS = 180

type Segment = { key: string; label: string; count: number }

type Quarter = { q: number; year: number; terms: LeaseTerm[] }

/** Active leases grouped by the calendar quarter they expire in, starting with the current quarter. */
function quarterBuckets(terms: LeaseTerm[]) {
  const now = new Date()
  const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  const buckets: Quarter[] = Array.from({ length: QUARTERS }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i * 3, 1)
    return { q: Math.floor(d.getMonth() / 3) + 1, year: d.getFullYear(), terms: [] }
  })
  let later = 0
  for (const term of terms) {
    if (term.status !== 'active') continue
    const e = term.expiration!
    const index = (e.getFullYear() - start.getFullYear()) * 4 + Math.floor(e.getMonth() / 3) - Math.floor(start.getMonth() / 3)
    if (index >= QUARTERS) later++
    else buckets[Math.max(0, index)].terms.push(term)
  }
  return { buckets, later }
}

/** Clean integer y-axis ticks from 0 up to at least max. */
function ticks(max: number) {
  const step = Math.max(1, Math.ceil(max / 4))
  const top = Math.max(step, Math.ceil(max / step) * step)
  return Array.from({ length: top / step + 1 }, (_, i) => i * step)
}

function Card({ title, subtitle, aside, className, children }: {
  title: string
  subtitle?: string
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`card home-card${className ? ` ${className}` : ''}`}>
      <header className="home-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

function StatTile({ label, value, hint, icon, tone }: {
  label: string
  value: number | undefined
  hint: string
  icon: string
  tone: 'critical' | 'warning' | 'accent' | 'neutral'
}) {
  return (
    <div className={`card home-tile home-tone-${tone}`}>
      <div className="home-tile-label">
        <span className="home-icon" aria-hidden>{icon}</span>
        {label}
      </div>
      <div className="home-tile-value">{value === undefined ? '…' : formatNumber(value)}</div>
      <div className="muted small">{hint}</div>
    </div>
  )
}

function StatusBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  return (
    <>
      <div className="status-bar" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.count}`).join(', ')}`}>
        {total === 0 ? (
          <span className="status-seg status-empty" style={{ flexGrow: 1 }} />
        ) : (
          segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <span
                key={s.key}
                className={`status-seg status-${s.key}`}
                style={{ flexGrow: s.count }}
                title={`${s.label}: ${formatNumber(s.count)}`}
              />
            ))
        )}
      </div>
      <ul className="status-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`status-swatch status-${s.key}`} aria-hidden />
            <span className="status-legend-label">{s.label}</span>
            <strong>{formatNumber(s.count)}</strong>
          </li>
        ))}
      </ul>
    </>
  )
}

function QuarterChart({ buckets }: { buckets: Quarter[] }) {
  const { t, tp } = useT(dashboard)
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(0, ...buckets.map((b) => b.terms.length))
  const axis = ticks(max)
  const top = axis[axis.length - 1]

  return (
    <div className="qchart" onMouseLeave={() => setActive(null)}>
      <div className="qchart-plot">
        {axis.map((v) => (
          <div key={v} className="qchart-grid" style={{ bottom: `${(v / top) * 100}%` }}>
            <span>{formatNumber(v)}</span>
          </div>
        ))}
        <div className="qchart-cols">
          {buckets.map((b, i) => {
            const count = b.terms.length
            const label = t('quarter', { q: b.q, year: b.year })
            return (
              <div
                key={`${b.year}-${b.q}`}
                className={`qchart-slot${active === i ? ' is-active' : ''}`}
                tabIndex={0}
                aria-label={`${label}: ${tp('leasesExpire', count)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                {count > 0 && (
                  <div className="qchart-col" style={{ height: `${(count / top) * 100}%` }}>
                    <span className="qchart-value">{formatNumber(count)}</span>
                  </div>
                )}
                {active === i && (
                  <div className={`qchart-tip${i >= buckets.length - 2 ? ' tip-left' : ''}`} role="tooltip">
                    <strong>{label}</strong>
                    <div>{tp('leasesExpire', count)}</div>
                    {b.terms.slice(0, 3).map((term) => (
                      <div key={term.main.id} className="qchart-tip-row">
                        <span>{term.main.title}</span>
                        <span className="muted">{formatDate(term.expiration!, { month: 'short', day: 'numeric' })}</span>
                      </div>
                    ))}
                    {count > 3 && <div className="muted">{t('tooltipMore', { count: count - 3 })}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="qchart-axis">
        {buckets.map((b) => (
          <span key={`${b.year}-${b.q}`}>{t('quarter', { q: b.q, year: b.year })}</span>
        ))}
      </div>
    </div>
  )
}

function DaysChip({ days }: { days: number }) {
  const { t, tp } = useT(dashboard)
  const text = tp('days', days)
  if (days <= URGENT_DAYS)
    return (
      <span className="chip chip-critical" title={t('urgentTitle', { days: URGENT_DAYS })}>
        <span className="chip-icon" aria-hidden>!</span>{text}
      </span>
    )
  if (days <= SOON_DAYS)
    return (
      <span className="chip chip-warning" title={t('soonTitle', { days: SOON_DAYS })}>
        <span className="chip-icon" aria-hidden>◷</span>{text}
      </span>
    )
  return <span className="muted">{text}</span>
}

export function Dashboard() {
  const { session } = useAuth()
  const { t, tp } = useT(dashboard)
  const { t: tc } = useT(common)
  const [files, setFiles] = useState<Array<{ is_scanned: boolean }> | null>(null)
  const [leases, setLeases] = useState<Lease[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([supabase.from('lease_files').select('is_scanned'), supabase.from('leases').select('*')]).then(
      ([filesRes, leasesRes]) => {
        const err = filesRes.error ?? leasesRes.error
        if (err) setError(err.message)
        setFiles(filesRes.data ?? [])
        setLeases(leasesRes.data ?? [])
      },
    )
  }, [])

  const terms = useMemo(() => (leases ? leaseTerms(leases) : null), [leases])
  const expiringSoon = useMemo(
    () => terms?.filter((x) => x.expiringSoon).sort((a, b) => a.expiration!.getTime() - b.expiration!.getTime()) ?? [],
    [terms],
  )
  const quarters = useMemo(() => (terms ? quarterBuckets(terms) : null), [terms])

  const countStatus = (status: LeaseTerm['status']) => terms?.filter((x) => x.status === status).length
  const active = countStatus('active')
  const expired = countStatus('expired')
  const renewed = terms?.filter((x) => x.renewed).length
  const urgent = terms ? expiringSoon.filter((x) => daysFromToday(x.expiration!) <= URGENT_DAYS).length : undefined

  const segments: Segment[] = [
    { key: 'active', label: t('segActive'), count: (active ?? 0) - expiringSoon.length },
    { key: 'expiring', label: t('segExpiring'), count: expiringSoon.length },
    { key: 'expired', label: t('segExpired'), count: expired ?? 0 },
    { key: 'unknown', label: t('segUnknown'), count: countStatus('unknown') ?? 0 },
  ]

  const docTypes: Array<[Lease['doc_type'], string]> = [
    ['main_lease', t('mainLeases')],
    ['amendment', t('amendments')],
    ['addendum', t('addenda')],
    ['commencement_letter', t('commencementLetters')],
    ['other', t('otherDocuments')],
  ]
  const docCounts = docTypes.map(([type, label]) => ({ type, label, count: leases?.filter((l) => l.doc_type === type).length ?? 0 }))
  const maxDocs = Math.max(1, ...docCounts.map((d) => d.count))
  const scanned = files?.filter((f) => f.is_scanned).length ?? 0

  const empty = leases !== null && leases.length === 0
  // Soonest-ending active lease, even when it is more than 12 months out.
  const next = terms
    ?.filter((x) => x.status === 'active')
    .reduce<LeaseTerm | null>((soonest, x) => (!soonest || x.expiration! < soonest.expiration! ? x : soonest), null)

  return (
    <main className="container wide home">
      <div className="page-header">
        <div>
          <h1>{t('title')}</h1>
          <p className="muted">{t('signedInAs', { email: session?.user.email ?? '' })}</p>
        </div>
        <div className="home-actions">
          <Link to="/chat" className="btn btn-ghost">{t('askAssistant')}</Link>
          <Link to="/leases" className="btn">{t('uploadLease')}</Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {empty ? (
        <section className="card home-empty">
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyBody')}</p>
          <Link to="/leases" className="btn">{t('uploadLease')}</Link>
        </section>
      ) : (
        <>
          <div className="home-top">
            <Card title={t('portfolioHealth')} className="home-hero">
              <div className="home-hero-figure">
                <span className="home-hero-value">{active === undefined ? '…' : formatNumber(active)}</span>
                <span className="home-hero-label">
                  {t('activeLeases')}
                  {terms && <span className="muted"> · {tp('ofMainLeases', terms.length)}</span>}
                </span>
              </div>
              <StatusBar segments={segments} label={t('statusBarLabel')} />
              {next && (
                <div className="home-next">
                  <span className="muted small">{t('nextExpiration')}</span>
                  <div className="home-next-row">
                    <Link to={`/leases/${next.main.id}`} className="doc-title panel-link">{next.main.title}</Link>
                    <span className="nowrap">
                      <span className="muted">{formatDate(next.expiration!)}</span>{' '}
                      <DaysChip days={daysFromToday(next.expiration!)} />
                    </span>
                  </div>
                </div>
              )}
            </Card>

            <div className="home-tiles">
              <StatTile label={t('within90')} value={urgent} hint={t('within90Hint')} icon="!" tone="critical" />
              <StatTile label={t('expiring12')} value={terms ? expiringSoon.length : undefined} hint={t('expiring12Hint')} icon="◷" tone="warning" />
              <StatTile label={t('renewedLeases')} value={renewed} hint={t('renewedHint')} icon="↻" tone="accent" />
              <StatTile label={t('expiredLeases')} value={expired} hint={t('expiredHint')} icon="✕" tone="neutral" />
            </div>
          </div>

          <div className="home-grid">
            <Card
              title={t('expirationsByQuarter')}
              subtitle={t('expirationsSub', { count: QUARTERS })}
              aside={quarters && quarters.later > 0 ? <span className="muted small">{tp('laterNote', quarters.later)}</span> : undefined}
            >
              {!quarters ? <p className="muted">{tc('loading')}</p> : <QuarterChart buckets={quarters.buckets} />}
            </Card>

            <Card title={t('documents')} subtitle={leases ? tp('documentsSub', leases.length) : undefined}>
              <ul className="doc-bars">
                {docCounts.map((d) => (
                  <li key={d.type}>
                    <span className="doc-bars-label">{d.label}</span>
                    <span className="doc-bars-track">
                      {d.count > 0 && <span className="doc-bars-fill" style={{ width: `${(d.count / maxDocs) * 100}%` }} />}
                    </span>
                    <span className="doc-bars-value">{leases ? formatNumber(d.count) : '…'}</span>
                  </li>
                ))}
              </ul>
              <div className="doc-foot">
                <div>
                  <span className="muted small">{t('filesUploaded')}</span>
                  <strong>{files ? formatNumber(files.length) : '…'}</strong>
                </div>
                <div>
                  <span className="muted small">{t('scanned')}</span>
                  <strong>{files ? formatNumber(scanned) : '…'}</strong>
                </div>
              </div>
            </Card>
          </div>

          <Card
            title={t('upcoming')}
            subtitle={t('upcomingSub')}
            className="home-table-card"
            aside={<Link to="/leases" className="link small">{t('viewAll')}</Link>}
          >
            {!terms ? (
              <p className="muted">{tc('loading')}</p>
            ) : expiringSoon.length === 0 ? (
              <p className="muted">{t('noneExpiring')}</p>
            ) : (
              <div className="table-wrap flush">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('colLease')}</th>
                      <th>{t('colTenant')}</th>
                      <th>{t('colPremises')}</th>
                      <th>{t('colExpires')}</th>
                      <th>{t('colDaysLeft')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiringSoon.map((term) => (
                      <tr key={term.main.id}>
                        <td>
                          <Link to={`/leases/${term.main.id}`} className="doc-title panel-link">{term.main.title}</Link>
                          {term.renewed && <span className="badge badge-success badge-inline">{t('renewed')}</span>}
                        </td>
                        <td>{term.main.tenant ?? '—'}</td>
                        <td>{term.main.premises ?? '—'}</td>
                        <td className="nowrap num">{formatDate(term.expiration!)}</td>
                        <td className="nowrap"><DaysChip days={daysFromToday(term.expiration!)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  )
}
