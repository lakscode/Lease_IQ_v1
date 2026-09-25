import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  DOC_TYPE_LABELS,
  fetchFileUsage,
  formatTokens,
  openStoredPdf,
  PROCESS_LABELS,
  totalInputTokens,
  type AiUsage,
  type Lease,
  type LeaseFile,
} from '../lib/leases'
import { LeaseClauses } from '../components/LeaseClauses'
import { TextViewer } from '../components/TextViewer'
import { CamReconciliation } from '../components/CamReconciliation'
import { useDialog } from '../components/Dialog'
import { daysFromToday, latestExpiration, parseDate } from '../lib/leaseStatus'
import { downloadLeaseReport, leaseSections } from '../lib/leaseReport'
import {
  fetchInsights,
  groupInsights,
  INSIGHT_STATUS_LABELS,
  INSIGHTS_STALE_MS,
  requestInsights,
  type InsightGroup,
  type LeaseInsights,
} from '../lib/insights'

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

const INSIGHTS_POLL_MS = 4000

/** Revenue and risk opportunities of the lease family, generated on demand. */
function InsightPanels({ familyId, leaseId }: { familyId: string; leaseId: string }) {
  const [insights, setInsights] = useState<LeaseInsights | null | undefined>(undefined)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generating =
    insights?.status === 'generating' && Date.now() - new Date(insights.started_at).getTime() < INSIGHTS_STALE_MS

  useEffect(() => {
    fetchInsights(familyId).then(setInsights, (e) => setError(e.message))
  }, [familyId])

  useEffect(() => {
    if (!generating) return
    const t = setInterval(() => fetchInsights(familyId).then(setInsights, (e) => setError(e.message)), INSIGHTS_POLL_MS)
    return () => clearInterval(t)
  }, [generating, familyId])

  const generate = async () => {
    setRequesting(true)
    setError(null)
    try {
      await requestInsights(leaseId)
      setInsights(await fetchInsights(familyId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRequesting(false)
    }
  }

  const ready = insights?.status === 'ready'
  const busy = requesting || generating
  const failed = insights?.status === 'failed' || (insights?.status === 'generating' && !generating)

  const bar = (
    <div className="insights-bar panel-wide">
      <div>
        <strong>Revenue and risk opportunities</strong>
        <div className="muted small">
          {busy
            ? 'Reading the lease and its amendments… this usually takes a minute or two.'
            : ready && insights?.generated_at
              ? `Generated ${new Date(insights.generated_at).toLocaleString()}${insights.model ? ` with ${insights.model}` : ''} from the main lease and all its amendments.`
              : 'AI reviews the main lease and all its amendments for the items below.'}
        </div>
        {failed && <div className="error small">Generation failed{insights?.error ? `: ${insights.error}` : ''}. Try again.</div>}
        {error && <div className="error small">{error}</div>}
      </div>
      <button className="btn btn-sm" onClick={generate} disabled={busy || insights === undefined}>
        {busy ? (
          <>
            <span className="spinner" role="status" aria-label="Generating" /> Generating…
          </>
        ) : ready ? (
          'Refresh'
        ) : (
          'Generate'
        )}
      </button>
    </div>
  )

  const panel = (group: InsightGroup, title: string, icon: string, color: 'purple' | 'yellow') => {
    const items = ready && insights ? groupInsights(insights.items, group) : []
    const found = items.filter((i) => i.status !== 'none')
    const absent = items.filter((i) => i.status === 'none')
    const actions = items.filter((i) => i.status === 'action').length
    return (
      <Panel title={title} icon={icon} color={color} wide aside={ready ? `${actions} action${actions === 1 ? '' : 's'}` : undefined}>
        {!ready ? (
          <p className="muted panel-empty">{busy ? 'Generating…' : 'Not generated yet. Click Generate above.'}</p>
        ) : (
          <>
            <ul className="insight-list">
              {found.map((i) => (
                <li key={i.category} className="insight">
                  <span className={`badge insight-badge insight-badge-${i.status}`}>{INSIGHT_STATUS_LABELS[i.status]}</span>
                  <div className="insight-body">
                    <div className="insight-title">
                      {i.label}
                      {i.status === 'action' && i.priority === 'high' && <span className="insight-priority">High priority</span>}
                    </div>
                    <div>{i.summary}</div>
                    {i.detail && <div className="muted small insight-detail">{i.detail}</div>}
                    {(i.due_date || i.amount || i.citations.length > 0) && (
                      <div className="insight-meta small">
                        {i.due_date && <span>Due {i.due_date}</span>}
                        {i.amount && <span>{i.amount}</span>}
                        {i.citations.map((c) => (
                          <Link key={`${c.leaseId}:${c.page}`} to={`/leases/${c.leaseId}`} className="chat-source" title={c.title}>
                            {c.leaseId === leaseId ? '' : `${c.title}, `}p. {c.page}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {absent.length > 0 && (
              <p className="muted small insight-absent">Not in lease: {absent.map((i) => i.label).join(', ')}</p>
            )}
          </>
        )}
      </Panel>
    )
  }

  return (
    <>
      {bar}
      {panel('revenue', 'Revenue opportunities', '📈', 'purple')}
      {panel('risk', 'Risk opportunities', '🛡️', 'yellow')}
      <Panel title="CAM reconciliation" icon="🧾" color="purple" wide>
        <CamReconciliation familyId={familyId} terms={insights?.cam ?? null} ready={ready} />
      </Panel>
    </>
  )
}

/** Claude token usage of the file this document came from, one row per analysis run. */
function UsagePanel({ fileId }: { fileId: string }) {
  const [runs, setRuns] = useState<AiUsage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchFileUsage(fileId).then(setRuns, (e) => setError(e.message))
  }, [fileId])

  if (error) return <p className="error small">Could not load token usage: {error}</p>
  if (!runs) return <p className="muted small">Loading…</p>
  if (!runs.length) {
    return <p className="muted panel-empty">No usage recorded yet. Usage is saved from the next analysis or re-analysis of this file.</p>
  }

  const input = runs.reduce((n, u) => n + totalInputTokens(u), 0)
  const output = runs.reduce((n, u) => n + u.output_tokens, 0)
  return (
    <table className="panel-table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Model</th>
          <th className="panel-num">Input</th>
          <th className="panel-num">Output</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((u) => (
          <tr key={u.id}>
            <td>
              {PROCESS_LABELS[u.process]}
              <div className="muted small">{new Date(u.created_at).toLocaleString()}</div>
            </td>
            <td className="small">
              {u.model}
              {u.served_by && u.served_by !== u.model && <div className="muted small">served by {u.served_by}</div>}
            </td>
            <td
              className="panel-num"
              title={`${u.input_tokens.toLocaleString()} uncached · ${u.cache_read_input_tokens.toLocaleString()} cache read · ${u.cache_creation_input_tokens.toLocaleString()} cache write`}
            >
              {formatTokens(totalInputTokens(u))}
            </td>
            <td className="panel-num">{formatTokens(u.output_tokens)}</td>
          </tr>
        ))}
        <tr className="usage-total">
          <td colSpan={2}>Total ({runs.length} {runs.length === 1 ? 'run' : 'runs'})</td>
          <td className="panel-num" title={`${input.toLocaleString()} tokens`}>{formatTokens(input)}</td>
          <td className="panel-num" title={`${output.toLocaleString()} tokens`}>{formatTokens(output)}</td>
        </tr>
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
  const [reporting, setReporting] = useState(false)
  const dialog = useDialog()

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

  const downloadReport = async () => {
    if (!lease) return
    setReporting(true)
    try {
      await downloadLeaseReport({ lease, fileName: file?.file_name ?? null, family, tasks, familyId: main?.id ?? lease.id })
    } catch (e) {
      await dialog.alert({ title: 'Could not create the report', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setReporting(false)
    }
  }

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

  const sections = leaseSections(lease)

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
              <Link to={`/chat?lease=${lease.id}`} className="btn btn-sm">Ask about this lease</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewing(lease)}>Text</button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!lease.storage_path}
                onClick={() => lease.storage_path && openStoredPdf(lease.storage_path).catch((e) => dialog.alert({ title: 'Could not open the PDF', message: e.message }))}
              >
                PDF
              </button>
              <button className="btn btn-ghost btn-sm" onClick={downloadReport} disabled={reporting} title="Download this lease abstract as a PDF report">
                {reporting ? 'Preparing…' : 'Report'}
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
              <Terms rows={sections.property} />
            </Panel>

            <Panel title="Rent" icon="💵" color="yellow">
              <Terms rows={sections.rent} />
            </Panel>

            <Panel title="Lease dates" icon="💬" color="purple">
              <Terms
                rows={sections.dates.map(([label, value]): [string, ReactNode, string?] =>
                  label === 'Expiration' ? [label, value, expiration ? describeExpiry(expiration) : undefined] : [label, value],
                )}
              />
            </Panel>

            <Panel title="Options" icon="📐" color="yellow">
              <Terms rows={sections.options} />
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

            <Panel title="Clauses" icon="📑" color="yellow" wide>
              <LeaseClauses leaseId={lease.id} />
            </Panel>

            <InsightPanels familyId={main?.id ?? lease.id} leaseId={lease.id} />

            <Panel title="AI usage" icon="🪙" color="purple" wide aside="Whole file">
              <UsagePanel fileId={lease.file_id} />
            </Panel>
          </div>
        </div>
      </div>

      {viewing && <TextViewer lease={viewing} onClose={() => setViewing(null)} />}
    </main>
  )
}
