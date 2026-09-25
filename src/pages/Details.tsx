import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DOC_TYPE_LABELS, openStoredPdf, type Lease, type LeaseFile } from '../lib/leases'
import { LeaseClauses } from '../components/LeaseClauses'
import { TextViewer } from '../components/TextViewer'
import { daysFromToday, latestExpiration, parseDate } from '../lib/leaseStatus'

const pages = (l: Lease) => (l.page_start === l.page_end ? `p. ${l.page_start}` : `p. ${l.page_start}–${l.page_end}`)

function describeExpiry(d: Date) {
  const days = daysFromToday(d)
  if (days < 0) return `expired ${-days} days ago`
  if (days === 0) return 'expires today'
  return `in ${days} days`
}

type Task = { key: string; text: string; due: string; urgent: boolean }

function Panel({
  title,
  icon,
  color,
  aside,
  wide,
  children,
}: {
  title: string
  icon: string
  color: 'purple' | 'yellow'
  aside?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <section className={`panel panel-${color}${wide ? ' panel-wide' : ''}`}>
      <header className="panel-head">
        <span className="panel-icon" aria-hidden>{icon}</span>
        <h2>{title}</h2>
        {aside && <span className="panel-aside">{aside}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

/** Label / value rows; long values are clamped with the full text in a tooltip. */
function Terms({ rows }: { rows: Array<[string, ReactNode, string?]> }) {
  return (
    <table className="panel-table">
      <tbody>
        {rows.map(([label, value, hint]) => (
          <tr key={label}>
            <td className="panel-label">{label}</td>
            <td>
              <div className="panel-value" title={typeof value === 'string' ? value : undefined}>
                {value || <span className="muted">—</span>}
              </div>
              {hint && <div className="muted small">{hint}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Details() {
  const { id } = useParams<{ id: string }>()
  const [leases, setLeases] = useState<Lease[]>([])
  const [files, setFiles] = useState<LeaseFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Lease | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([supabase.from('leases').select('*'), supabase.from('lease_files').select('*')]).then(
      ([leasesRes, filesRes]) => {
        const err = leasesRes.error ?? filesRes.error
        if (err) setError(err.message)
        setLeases(leasesRes.data ?? [])
        setFiles(filesRes.data ?? [])
        setLoading(false)
      },
    )
  }, [id])

  const lease = leases.find((l) => l.id === id)
  const main = lease && (lease.parent_id ? leases.find((l) => l.id === lease.parent_id) : lease)
  const file = lease && files.find((f) => f.id === lease.file_id)

  // The main lease and every document linked to it, in date order.
  const family = useMemo(() => {
    if (!main) return lease ? [lease] : []
    const children = leases
      .filter((l) => l.parent_id === main.id)
      .sort((a, b) => (a.effective_date ?? '').localeCompare(b.effective_date ?? '') || a.page_start - b.page_start)
    return [main, ...children]
  }, [leases, lease, main])

  const a = lease?.abstract ?? {}
  const expiration = parseDate(a.expiration_date)
  // Amendments and extensions may move the date; the latest one stated in the family wins.
  const familyExpiration = useMemo(() => latestExpiration(family), [family])

  const tasks = useMemo<Task[]>(() => {
    if (!lease) return []
    const list: Task[] = []
    if (file?.status === 'failed') {
      list.push({ key: 'failed', text: `Retry "${file.file_name}"`, due: 'Now', urgent: true })
    }
    if (lease.doc_type !== 'main_lease' && lease.doc_type !== 'other' && !lease.parent_id) {
      list.push({ key: 'parent', text: 'Upload the main lease for this document', due: 'Now', urgent: true })
    }
    if (familyExpiration && daysFromToday(familyExpiration) <= 365) {
      const days = daysFromToday(familyExpiration)
      list.push({
        key: 'expiry',
        text: days < 0 ? 'Lease has expired — confirm holdover or renewal' : 'Review renewal or exit',
        due: familyExpiration.toLocaleDateString(),
        urgent: days <= 90,
      })
    }
    if (a.renewal_options && familyExpiration && daysFromToday(familyExpiration) >= 0) {
      list.push({ key: 'renewal', text: 'Check the renewal option notice period', due: familyExpiration.toLocaleDateString(), urgent: false })
    }
    if (!familyExpiration) {
      list.push({ key: 'no-expiry', text: 'Confirm the expiration date', due: '—', urgent: false })
    }
    return list
  }, [lease, file, familyExpiration, a.renewal_options])

  if (loading) {
    return (
      <main className="container wide">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (!lease) {
    return (
      <main className="container wide">
        <p className="error">{error ?? 'Document not found.'}</p>
        <Link to="/leases" className="btn btn-ghost">← Back to Lease Abstraction</Link>
      </main>
    )
  }

  return (
    <main className="container wide">
      <div className="dash">
        <div className="dash-title">
          <div className="dash-title-row">
            <div>
              <Link to="/leases" className="dash-back">← Lease Abstraction</Link>
              <h1>{lease.title}</h1>
            </div>
            <div className="dash-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setViewing(lease)}>Text</button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!lease.storage_path}
                onClick={() => lease.storage_path && openStoredPdf(lease.storage_path).catch((e) => alert(e.message))}
              >
                PDF
              </button>
            </div>
          </div>
          <p>
            <span className={`badge badge-${lease.doc_type}`}>{DOC_TYPE_LABELS[lease.doc_type]}</span>{' '}
            {pages(lease)} of {file?.file_name ?? 'unknown file'}
            {lease.summary && <> · {lease.summary}</>}
          </p>
        </div>

        <div className="dash-board">
          {error && <p className="error">{error}</p>}
          <div className="dash-grid">
            <Panel title="Property" icon="🏢" color="purple">
              <Terms
                rows={[
                  ['Premises', lease.premises ?? a.premises_address],
                  ['Rentable area', a.rentable_area],
                  ['Permitted use', a.permitted_use],
                  ['Landlord', lease.landlord ?? a.landlord],
                  ['Tenant', lease.tenant ?? a.tenant],
                ]}
              />
            </Panel>

            <Panel title="Rent" icon="💵" color="yellow">
              <Terms
                rows={[
                  ['Base rent', a.base_rent],
                  ['Escalations', a.rent_escalations],
                  ['Security deposit', a.security_deposit],
                  ['Operating expenses', a.operating_expenses],
                ]}
              />
            </Panel>

            <Panel title="Lease dates" icon="💬" color="purple">
              <Terms
                rows={[
                  ['Effective', lease.effective_date],
                  ['Commencement', a.commencement_date],
                  ['Expiration', a.expiration_date, expiration ? describeExpiry(expiration) : undefined],
                  ['Term', a.term],
                ]}
              />
            </Panel>

            <Panel title="Options" icon="📐" color="yellow">
              <Terms
                rows={[
                  ['Renewal', a.renewal_options],
                  ['Termination', a.termination_options],
                  ...(lease.doc_type === 'main_lease' ? [] : ([['Changes made', a.changes_made]] as Array<[string, ReactNode]>)),
                ]}
              />
            </Panel>

            <Panel title="Related documents" icon="📄" color="purple">
              <table className="panel-table">
                <tbody>
                  {family.map((doc) => (
                    <tr key={doc.id} className={doc.id === lease.id ? 'panel-current' : undefined}>
                      <td>
                        <span className={`badge badge-${doc.doc_type}`}>{DOC_TYPE_LABELS[doc.doc_type]}</span>
                      </td>
                      <td>
                        {doc.id === lease.id ? (
                          <span className="panel-strong">{doc.title}</span>
                        ) : (
                          <Link to={`/leases/${doc.id}`} className="panel-link">{doc.title}</Link>
                        )}
                      </td>
                      <td className="panel-num">{doc.effective_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!main && <p className="muted small">Main lease not found.</p>}
            </Panel>

            <Panel title="Alerts and tasks" icon="🔔" color="yellow" aside="Due">
              {tasks.length === 0 ? (
                <p className="muted panel-empty">Nothing needs attention.</p>
              ) : (
                <table className="panel-table">
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.key}>
                        <td>
                          <span className="task-arrow" aria-hidden>▶</span>
                          {t.text}
                        </td>
                        <td className="panel-num nowrap">{t.due}</td>
                        <td className="panel-num">
                          <span className={`task-flag${t.urgent ? ' task-flag-urgent' : ''}`} title={t.urgent ? 'Urgent' : undefined} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Clauses" icon="📑" color="purple" wide>
              <LeaseClauses leaseId={lease.id} />
            </Panel>
          </div>
        </div>
      </div>

      {viewing && <TextViewer lease={viewing} onClose={() => setViewing(null)} />}
    </main>
  )
}
