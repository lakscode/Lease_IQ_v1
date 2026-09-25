import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import {
  deleteLeaseFile,
  formatTokens,
  PROCESS_LABELS,
  totalInputTokens,
  openStoredPdf,
  retryLeaseFile,
  uploadLeaseFile,
  type AiUsage,
  type Lease,
  type LeaseFile,
  type Stage,
} from '../lib/leases'
import { DocumentCells, fileDocuments } from '../components/LeaseDocuments'
import { TextViewer } from '../components/TextViewer'
import { LogViewer } from '../components/LogViewer'
import { checkSetup, type SetupIssue } from '../lib/health'
import { useDialog } from '../components/Dialog'

const FINAL_STATUSES = new Set(['completed', 'failed'])
const REFRESH_MS = 4000

function describeStage(s: Stage): { text: string; percent?: number } {
  switch (s.stage) {
    case 'extracting':
      return {
        text: `Reading page ${s.page} of ${s.pageCount}${s.ocr ? ' (scanned page, converting with OCR)' : ''}`,
        percent: Math.round((s.page / s.pageCount) * 100),
      }
    case 'uploading':
      return { text: 'Uploading…' }
    case 'retrying':
      return { text: 'Retrying: downloading original PDF…' }
    case 'reanalyzing':
      return { text: 'Re-analyzing: downloading original PDF…' }
    case 'analyzing':
      return { text: 'Analyzing with AI: finding the main lease, amendments, addendum and commencement letters, and abstracting key terms…' }
    case 'splitting':
      return { text: `Splitting into separate documents (${s.done + 1} of ${s.total})…`, percent: Math.round(((s.done + 1) / s.total) * 100) }
  }
}

export function LeaseAbstraction() {
  const [files, setFiles] = useState<LeaseFile[]>([])
  const [leases, setLeases] = useState<Lease[]>([])
  const [usage, setUsage] = useState<AiUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [upload, setUpload] = useState<{ name: string; stage: Stage } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [busyFiles, setBusyFiles] = useState<Record<string, Stage>>({})
  const [viewing, setViewing] = useState<Lease | null>(null)
  const [logFileId, setLogFileId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [setupIssues, setSetupIssues] = useState<SetupIssue[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const dialog = useDialog()

  const load = useCallback(async () => {
    const [filesRes, leasesRes, usageRes] = await Promise.all([
      supabase.from('lease_files').select('*').order('created_at', { ascending: false }),
      supabase.from('leases').select('*'),
      supabase.from('ai_usage').select('*').not('file_id', 'is', null).order('created_at'),
    ])
    // Usage is extra detail; the table still loads without it.
    if (usageRes.error) console.warn('[usage] loading ai_usage failed:', usageRes.error.message)
    else setUsage(usageRes.data as AiUsage[])
    const err = filesRes.error ?? leasesRes.error
    if (err) setLoadError(err.message)
    else {
      setLoadError(null)
      setFiles(filesRes.data as LeaseFile[])
      setLeases(leasesRes.data as Lease[])
      setLastRefreshed(new Date())
    }
    setLoading(false)
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([load(), checkSetup().then(setSetupIssues)])
    setRefreshing(false)
  }

  useEffect(() => {
    checkSetup().then(setSetupIssues)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Keep the table fresh while anything is still processing.
  const anyPending = upload !== null || files.some((f) => !FINAL_STATUSES.has(f.status))
  useEffect(() => {
    if (!anyPending) return
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [anyPending, load])

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || upload) return
    setUploadError(null)
    for (const file of Array.from(list)) {
      setUpload({ name: file.name, stage: { stage: 'uploading' } })
      try {
        await uploadLeaseFile(file, (stage) => setUpload({ name: file.name, stage }))
      } catch (e) {
        setUploadError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
      await load()
    }
    setUpload(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const retry = async (file: LeaseFile, reanalyze = false) => {
    if (
      reanalyze &&
      !(await dialog.confirm({
        title: 'Re-analyze this file?',
        message: (
          <>
            <strong>{file.file_name}</strong> will be analyzed again with AI. Its documents and clauses will be replaced with the
            new results.
          </>
        ),
        confirmLabel: 'Re-analyze',
      }))
    ) {
      return
    }
    setBusyFiles((b) => ({ ...b, [file.id]: { stage: reanalyze ? 'reanalyzing' : 'retrying' } }))
    try {
      await retryLeaseFile(file, (stage) => setBusyFiles((b) => ({ ...b, [file.id]: stage })), { reanalyze })
    } catch (e) {
      // Details are in the file's processing log; the message is shown in the table.
      console.error(`[lease ${file.id.slice(0, 8)}] ${reanalyze ? 're-analyze' : 'retry'}: failed`, e)
    }
    setBusyFiles(({ [file.id]: _, ...rest }) => rest)
    await load()
  }

  const remove = async (file: LeaseFile) => {
    const ok = await dialog.confirm({
      title: 'Delete this file?',
      message: (
        <>
          <strong>{file.file_name}</strong> and every document extracted from it will be deleted. This can't be undone.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteLeaseFile(file)
    } catch (e) {
      await dialog.alert({ title: 'Could not delete the file', message: e instanceof Error ? e.message : String(e) })
    }
    await load()
  }

  const filesById = new Map(files.map((f) => [f.id, f]))
  const usageByFile = new Map<string, AiUsage[]>()
  for (const u of usage) if (u.file_id) usageByFile.set(u.file_id, [...(usageByFile.get(u.file_id) ?? []), u])
  const logFile = logFileId ? filesById.get(logFileId) : undefined
  const progress = upload ? describeStage(upload.stage) : null

  return (
    <main className="container wide">
      <h1>Lease Abstraction</h1>
      <p className="muted">
        Upload lease PDFs. Scanned pages are converted to text with OCR, then AI splits bundled files into the main
        lease, amendments, addendum and commencement letters, and extracts the key terms.
      </p>

      {setupIssues.length > 0 && (
        <div className="setup-warning" role="alert">
          <strong>Setup incomplete</strong>
          <ul>
            {setupIssues.map((issue) => (
              <li key={issue.key}>{issue.message}</li>
            ))}
          </ul>
          <span className="muted small">Fix these, then click Refresh below to re-check.</span>
        </div>
      )}

      <section
        className={`card dropzone${dragging ? ' dragging' : ''}${upload ? ' busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {upload && progress ? (
          <div className="upload-progress">
            <strong>{upload.name}</strong>
            <p>{progress.text}</p>
            <div className="progress">
              <div
                className={`progress-bar${progress.percent === undefined ? ' indeterminate' : ''}`}
                style={progress.percent !== undefined ? { width: `${progress.percent}%` } : undefined}
              />
            </div>
            <p className="muted small">Keep this tab open until processing finishes.</p>
          </div>
        ) : (
          <>
            <p>
              <strong>Drag and drop PDF files here</strong> or
            </p>
            <button className="btn" onClick={() => inputRef.current?.click()}>Choose PDF</button>
            <p className="muted small">PDF only, up to 50 MB each. Digital and scanned files are supported.</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </section>
      {uploadError && <p className="error">{uploadError}</p>}

      <div className="section-header">
        <h2>Uploaded files</h2>
        <div className="section-actions">
          {lastRefreshed && <span className="muted small">Updated {lastRefreshed.toLocaleTimeString()}</span>}
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing} title="Reload the uploaded files table">
            <span className={`refresh-icon${refreshing ? ' spinning' : ''}`} aria-hidden="true">⟳</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {loadError && <p className="error">{loadError}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="muted">No files uploaded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table files-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Document</th>
                <th>Effective</th>
                <th>Tenant</th>
                <th>Premises</th>
                <th />
                <th />
              </tr>
            </thead>
            {files.map((file, i) => {
              const docs = fileDocuments(file, leases)
              const busy = busyFiles[file.id]
              const isUploading = upload !== null && !FINAL_STATUSES.has(file.status)
              const stalled = !FINAL_STATUSES.has(file.status) && !busy && !isUploading
              const span = Math.max(docs.length, 1)

              const fileCell = (
                <td rowSpan={span} className="file-cell">
                  <button
                    className="file-name"
                    onClick={() => openStoredPdf(file.storage_path).catch((e) => dialog.alert({ title: 'Could not open the PDF', message: e.message }))}
                    title="Open the original PDF"
                  >
                    {file.file_name}
                  </button>
                  <div className="file-badges">
                    <StatusBadge file={file} busy={busy} />
                    {file.is_scanned ? (
                      <span className="badge badge-ocr" title={`${file.ocr_pages} page(s) converted with OCR`}>
                        Scanned (OCR {file.ocr_pages}p)
                      </span>
                    ) : (
                      <span className="badge">Digital</span>
                    )}
                  </div>
                  <div className="muted small">
                    {file.page_count} {file.page_count === 1 ? 'page' : 'pages'} · {new Date(file.created_at).toLocaleString()}
                  </div>
                  <UsageSummary runs={usageByFile.get(file.id) ?? []} />
                  {busy && <div className="muted small stage-detail">{describeStage(busy).text}</div>}
                  {!busy && file.status === 'failed' && file.error && <div className="error small">{file.error}</div>}
                </td>
              )

              const fileActions = (
                <td rowSpan={span} className="actions file-actions">
                  {busy ? (
                    <button className="btn btn-ghost btn-sm" disabled>
                      <Spinner /> {BUSY_LABELS[busy.stage]}…
                    </button>
                  ) : file.status === 'failed' || stalled ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => retry(file)}>Retry</button>
                  ) : (
                    file.status === 'completed' && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => retry(file, true)}
                        title="Run the AI analysis again and replace this file's documents and clauses"
                      >
                        Re-analyze
                      </button>
                    )
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setLogFileId(file.id)}>Log</button>
                  <button className="btn btn-ghost btn-sm danger" onClick={() => remove(file)} disabled={!!busy || isUploading}>
                    Delete
                  </button>
                </td>
              )

              return (
                <tbody key={file.id} className={`file-group${i % 2 ? ' file-group-alt' : ''}`}>
                  {docs.length === 0 ? (
                    <tr>
                      {fileCell}
                      <td colSpan={6} className="muted doc-empty-cell">
                        {FINAL_STATUSES.has(file.status) && !busy
                          ? 'No lease documents were found in this file.'
                          : 'Documents appear here once processing finishes.'}
                      </td>
                      {fileActions}
                    </tr>
                  ) : (
                    docs.map((entry, j) => (
                      <tr key={entry.lease.id}>
                        {j === 0 && fileCell}
                        <DocumentCells entry={entry} onViewText={setViewing} />
                        {j === 0 && fileActions}
                      </tr>
                    ))
                  )}
                </tbody>
              )
            })}
          </table>
        </div>
      )}

      {viewing && <TextViewer lease={viewing} onClose={() => setViewing(null)} />}
      {logFile && (
        <LogViewer
          file={logFile}
          live={!FINAL_STATUSES.has(logFile.status) || !!busyFiles[logFile.id]}
          onClose={() => setLogFileId(null)}
        />
      )}
    </main>
  )
}

/** Token totals for a file, with each Claude request listed in the tooltip. */
function UsageSummary({ runs }: { runs: AiUsage[] }) {
  if (!runs.length) return null
  const input = runs.reduce((n, u) => n + totalInputTokens(u), 0)
  const output = runs.reduce((n, u) => n + u.output_tokens, 0)
  const detail = runs
    .map((u) => {
      const cache = u.cache_read_input_tokens || u.cache_creation_input_tokens
        ? ` (cache: ${formatTokens(u.cache_read_input_tokens)} read, ${formatTokens(u.cache_creation_input_tokens)} written)`
        : ''
      const served = u.served_by && u.served_by !== u.model ? `, served by ${u.served_by}` : ''
      return `${new Date(u.created_at).toLocaleString()} · ${PROCESS_LABELS[u.process]} · ${u.model}${served}\n  ${totalInputTokens(u).toLocaleString()} input${cache}, ${u.output_tokens.toLocaleString()} output`
    })
    .join('\n')
  return (
    <div className="muted small usage-summary" title={detail}>
      Tokens: {formatTokens(input)} in · {formatTokens(output)} out
      {runs.length > 1 && ` · ${runs.length} runs`}
    </div>
  )
}

function Spinner() {
  return <span className="spinner" role="status" aria-label="Processing" />
}

const BUSY_LABELS: Record<Stage['stage'], string> = {
  retrying: 'Retrying',
  reanalyzing: 'Re-analyzing',
  extracting: 'Extracting text',
  uploading: 'Uploading',
  analyzing: 'Analyzing',
  splitting: 'Splitting',
}

function StatusBadge({ file, busy }: { file: LeaseFile; busy?: Stage }) {
  const pending = (label: string) => (
    <span className="badge badge-pending">
      <Spinner /> {label}
    </span>
  )
  if (busy) return pending(BUSY_LABELS[busy.stage])
  switch (file.status) {
    case 'completed':
      return <span className="badge badge-success">✓ Completed</span>
    case 'failed':
      return <span className="badge badge-error">✕ Failed</span>
    case 'analyzing':
      return pending('Analyzing')
    case 'analyzed':
      return pending('Splitting')
    default:
      return pending('Processing')
  }
}
