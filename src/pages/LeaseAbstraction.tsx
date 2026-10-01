import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { db } from '../lib/db'
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
import { formatDateTime, formatNumber, formatTime, useT, type Translator } from '../i18n'
import { common } from '../i18n/messages/common'
import { abstraction } from '../i18n/messages/abstraction'

type T = Translator<typeof abstraction.en>['t']

/** Renders a translated sentence with the {name} placeholder in bold. */
function withStrongName(text: string, name: string) {
  const [before, after = ''] = text.split('{name}')
  return (
    <>
      {before}
      <strong>{name}</strong>
      {after}
    </>
  )
}

const FINAL_STATUSES = new Set(['completed', 'failed'])
const REFRESH_MS = 4000

function describeStage(s: Stage, t: T): { text: string; percent?: number } {
  switch (s.stage) {
    case 'extracting':
      return {
        text: t(s.ocr ? 'stageReadingPageOcr' : 'stageReadingPage', { page: formatNumber(s.page), pageCount: formatNumber(s.pageCount) }),
        percent: Math.round((s.page / s.pageCount) * 100),
      }
    case 'uploading':
      return { text: t('stageUploading') }
    case 'retrying':
      return { text: t('stageRetrying') }
    case 'reanalyzing':
      return { text: t('stageReanalyzing') }
    case 'analyzing':
      return { text: t('stageAnalyzing') }
    case 'splitting':
      return {
        text: t('stageSplitting', { current: formatNumber(s.done + 1), total: formatNumber(s.total) }),
        percent: Math.round(((s.done + 1) / s.total) * 100),
      }
  }
}

export function LeaseAbstraction() {
  const { t, tp } = useT(abstraction)
  const { t: tc } = useT(common)
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
      db.from('lease_files').select('*').order('created_at', { ascending: false }),
      db.from('leases').select('*'),
      db.from('ai_usage').select('*').not('file_id', 'is', null).order('created_at'),
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

  // Main leases whose amendments and linked documents are shown.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggleExpanded = (leaseId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(leaseId)) next.add(leaseId)
      return next
    })
  const fileNames = new Map(files.map((f) => [f.id, f.file_name]))

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || upload) return
    setUploadError(null)
    for (const file of Array.from(list)) {
      setUpload({ name: file.name, stage: { stage: 'uploading' } })
      try {
        await uploadLeaseFile(file, (stage) => setUpload({ name: file.name, stage }))
      } catch (e) {
        setUploadError(t('uploadError', { name: file.name, error: e instanceof Error ? e.message : String(e) }))
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
        title: t('reanalyzeTitle'),
        message: withStrongName(t('reanalyzeMessage'), file.file_name),
        confirmLabel: t('reanalyze'),
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
      title: t('deleteTitle'),
      message: withStrongName(t('deleteMessage'), file.file_name),
      confirmLabel: tc('delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteLeaseFile(file)
    } catch (e) {
      await dialog.alert({ title: t('deleteFailed'), message: e instanceof Error ? e.message : String(e) })
    }
    await load()
  }

  const filesById = new Map(files.map((f) => [f.id, f]))
  const usageByFile = new Map<string, AiUsage[]>()
  for (const u of usage) if (u.file_id) usageByFile.set(u.file_id, [...(usageByFile.get(u.file_id) ?? []), u])
  const logFile = logFileId ? filesById.get(logFileId) : undefined
  const progress = upload ? describeStage(upload.stage, t) : null

  return (
    <main className="container wide">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>

      {setupIssues.length > 0 && (
        <div className="setup-warning" role="alert">
          <strong>{t('setupIncomplete')}</strong>
          <ul>
            {setupIssues.map((issue) => (
              <li key={issue.key}>{issue.message}</li>
            ))}
          </ul>
          <span className="muted small">{t('setupHint')}</span>
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
            <p className="muted small">{t('keepTabOpen')}</p>
          </div>
        ) : (
          <>
            <p>
              <strong>{t('dropHere')}</strong> {t('dropOr')}
            </p>
            <button className="btn" onClick={() => inputRef.current?.click()}>{t('choosePdf')}</button>
            <p className="muted small">{t('dropHint')}</p>
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
        <h2>{t('uploadedFiles')}</h2>
        <div className="section-actions">
          {lastRefreshed && <span className="muted small">{t('updatedAt', { time: formatTime(lastRefreshed) })}</span>}
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing} title={t('refreshTitle')}>
            <span className={`refresh-icon${refreshing ? ' spinning' : ''}`} aria-hidden="true">⟳</span>
            {refreshing ? t('refreshing') : t('refresh')}
          </button>
        </div>
      </div>
      {loadError && <p className="error">{loadError}</p>}
      {loading ? (
        <p className="muted">{tc('loading')}</p>
      ) : files.length === 0 ? (
        <p className="muted">{t('noFiles')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table files-table">
            <thead>
              <tr>
                <th>{t('colFile')}</th>
                <th>{t('colType')}</th>
                <th>{t('colDocument')}</th>
                <th>{t('colEffective')}</th>
                <th>{t('colTenant')}</th>
                <th>{t('colPremises')}</th>
                <th />
                <th />
              </tr>
            </thead>
            {files.map((file, i) => {
              const docs = fileDocuments(file, leases, expanded, fileNames)
              const busy = busyFiles[file.id]
              const isUploading = upload !== null && !FINAL_STATUSES.has(file.status)
              const stalled = !FINAL_STATUSES.has(file.status) && !busy && !isUploading
              const span = Math.max(docs.length, 1)

              const fileCell = (
                <td rowSpan={span} className="file-cell">
                  <button
                    className="file-name"
                    onClick={() => openStoredPdf(file.storage_path).catch((e) => dialog.alert({ title: t('openPdfFailed'), message: e.message }))}
                    title={t('openPdfTitle')}
                  >
                    {file.file_name}
                  </button>
                  <div className="file-badges">
                    <StatusBadge file={file} busy={busy} />
                    {file.is_scanned ? (
                      <span className="badge badge-ocr" title={tp('ocrPagesTitle', file.ocr_pages)}>
                        {t('scannedBadge', { count: formatNumber(file.ocr_pages) })}
                      </span>
                    ) : (
                      <span className="badge">{t('digitalBadge')}</span>
                    )}
                  </div>
                  <div className="muted small">
                    {tp('pages', file.page_count)} · {formatDateTime(file.created_at)}
                  </div>
                  <UsageSummary runs={usageByFile.get(file.id) ?? []} />
                  {busy && <div className="muted small stage-detail">{describeStage(busy, t).text}</div>}
                  {!busy && file.status === 'failed' && file.error && <div className="error small">{file.error}</div>}
                </td>
              )

              const fileActions = (
                <td rowSpan={span} className="actions file-actions">
                  {busy ? (
                    <button className="btn btn-ghost btn-sm" disabled>
                      <Spinner /> {t(`busy_${busy.stage}`)}…
                    </button>
                  ) : file.status === 'failed' || stalled ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => retry(file)}>{tc('retry')}</button>
                  ) : (
                    file.status === 'completed' && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => retry(file, true)}
                        title={t('reanalyzeTitleAttr')}
                      >
                        {t('reanalyze')}
                      </button>
                    )
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setLogFileId(file.id)}>{t('log')}</button>
                  <button className="btn btn-ghost btn-sm danger" onClick={() => remove(file)} disabled={!!busy || isUploading}>
                    {tc('delete')}
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
                          ? t('noDocumentsFound')
                          : t('documentsPending')}
                      </td>
                      {fileActions}
                    </tr>
                  ) : (
                    docs.map((entry, j) => (
                      <tr key={entry.lease.id}>
                        {j === 0 && fileCell}
                        <DocumentCells entry={entry} onViewText={setViewing} onToggle={toggleExpanded} onAmendmentUploaded={load} />
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
  const { t, tp } = useT(abstraction)
  if (!runs.length) return null
  const input = runs.reduce((n, u) => n + totalInputTokens(u), 0)
  const output = runs.reduce((n, u) => n + u.output_tokens, 0)
  const detail = runs
    .map((u) => {
      const cache = u.cache_read_input_tokens || u.cache_creation_input_tokens
        ? t('usageCache', { read: formatTokens(u.cache_read_input_tokens), written: formatTokens(u.cache_creation_input_tokens) })
        : ''
      const served = u.served_by && u.served_by !== u.model ? t('usageServedBy', { name: u.served_by }) : ''
      const line = t('usageLine', { input: formatNumber(totalInputTokens(u)), cache, output: formatNumber(u.output_tokens) })
      return `${formatDateTime(u.created_at)} · ${PROCESS_LABELS[u.process]} · ${u.model}${served}\n  ${line}`
    })
    .join('\n')
  return (
    <div className="muted small usage-summary" title={detail}>
      {t('usageTokens', { input: formatTokens(input), output: formatTokens(output) })}
      {runs.length > 1 && ` · ${tp('usageRuns', runs.length)}`}
    </div>
  )
}

function Spinner() {
  const { t } = useT(abstraction)
  return <span className="spinner" role="status" aria-label={t('processing')} />
}

function StatusBadge({ file, busy }: { file: LeaseFile; busy?: Stage }) {
  const { t } = useT(abstraction)
  const pending = (label: string) => (
    <span className="badge badge-pending">
      <Spinner /> {label}
    </span>
  )
  if (busy) return pending(t(`busy_${busy.stage}`))
  switch (file.status) {
    case 'completed':
      return <span className="badge badge-success">{t('completed')}</span>
    case 'failed':
      return <span className="badge badge-error">{t('failed')}</span>
    case 'analyzing':
      return pending(t('busy_analyzing'))
    case 'analyzed':
      return pending(t('busy_splitting'))
    default:
      return pending(t('processing'))
  }
}
