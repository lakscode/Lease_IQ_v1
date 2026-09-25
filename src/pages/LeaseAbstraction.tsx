import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import {
  deleteLeaseFile,
  openStoredPdf,
  retryLeaseFile,
  uploadLeaseFile,
  type Lease,
  type LeaseFile,
  type Stage,
} from '../lib/leases'
import { LeaseDocuments } from '../components/LeaseDocuments'
import { TextViewer } from '../components/TextViewer'
import { LogViewer } from '../components/LogViewer'
import { checkSetup, type SetupIssue } from '../lib/health'

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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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

  const load = useCallback(async () => {
    const [filesRes, leasesRes] = await Promise.all([
      supabase.from('lease_files').select('*').order('created_at', { ascending: false }),
      supabase.from('leases').select('*'),
    ])
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
      !confirm(`Re-analyze "${file.file_name}"? Its documents and clauses will be replaced with the results of a new AI analysis.`)
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
    if (!confirm(`Delete "${file.file_name}" and all documents extracted from it?`)) return
    try {
      await deleteLeaseFile(file)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
    await load()
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const filesById = new Map(files.map((f) => [f.id, f]))
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
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>File</th>
                <th>Pages</th>
                <th>Source</th>
                <th>Documents</th>
                <th>Main leases</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const docs = leases.filter((l) => l.file_id === file.id)
                const busy = busyFiles[file.id]
                const isUploading = upload !== null && !FINAL_STATUSES.has(file.status)
                const stalled = !FINAL_STATUSES.has(file.status) && !busy && !isUploading
                const isOpen = expanded.has(file.id)
                return (
                  <Fragment key={file.id}>
                    <tr className="file-row" onClick={() => toggle(file.id)}>
                      <td className="chevron">{isOpen ? '▾' : '▸'}</td>
                      <td className="doc-title">{file.file_name}</td>
                      <td>{file.page_count}</td>
                      <td>
                        {file.is_scanned ? (
                          <span className="badge badge-ocr" title={`${file.ocr_pages} page(s) converted with OCR`}>
                            Scanned (OCR {file.ocr_pages}p)
                          </span>
                        ) : (
                          <span className="badge">Digital</span>
                        )}
                      </td>
                      <td>{docs.length}</td>
                      <td>{docs.filter((d) => d.doc_type === 'main_lease').length}</td>
                      <td>
                        <StatusBadge file={file} busy={busy} />
                        {busy && <div className="muted small stage-detail">{describeStage(busy).text}</div>}
                        {!busy && file.status === 'failed' && file.error && <div className="error small">{file.error}</div>}
                      </td>
                      <td className="nowrap">{new Date(file.created_at).toLocaleString()}</td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
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
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => openStoredPdf(file.storage_path).catch((e) => alert(e.message))}
                        >
                          PDF
                        </button>
                        <button
                          className="btn btn-ghost btn-sm danger"
                          onClick={() => remove(file)}
                          disabled={!!busy || isUploading}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="expanded-row">
                        <td colSpan={9}>
                          <LeaseDocuments file={file} allLeases={leases} filesById={filesById} onViewText={setViewing} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
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
