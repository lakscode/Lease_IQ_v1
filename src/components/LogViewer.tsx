import { useCallback, useEffect, useState } from 'react'
import { fetchFileLogs, type LeaseFile, type LeaseFileLog } from '../lib/leases'
import { formatTime as formatLocaleTime, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { logViewer } from '../i18n/messages/logViewer'

const REFRESH_MS = 3000

const formatTime = (iso: string) =>
  formatLocaleTime(iso, { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)

const toText = (logs: LeaseFileLog[]) =>
  logs
    .map((l) => {
      const data = l.data ? ` ${JSON.stringify(l.data)}` : ''
      return `${l.created_at} [${l.source}] ${l.level.toUpperCase()} ${l.step}: ${l.message}${data}`
    })
    .join('\n')

/** Modal with the step-by-step processing log of one uploaded file. */
export function LogViewer({ file, live, onClose }: { file: LeaseFile; live: boolean; onClose: () => void }) {
  const { t } = useT(logViewer)
  const { t: tc } = useT(common)
  const [logs, setLogs] = useState<LeaseFileLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [openData, setOpenData] = useState<Set<number>>(new Set())

  const load = useCallback(() => {
    fetchFileLogs(file.id).then(
      (rows) => {
        setLogs(rows)
        setError(null)
      },
      (e) => setError(e.message),
    )
  }, [file.id])

  useEffect(() => {
    load()
    if (!live) return
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load, live])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    if (!logs) return
    await navigator.clipboard.writeText(`${t('clipboardHeader', { name: file.file_name, id: file.id, status: file.status })}\n\n${toText(logs)}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toggleData = (id: number) =>
    setOpenData((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('ariaLabel', { name: file.file_name })}>
        <div className="modal-header">
          <div>
            <h3>{t('title')}</h3>
            <div className="muted small">
              {file.file_name}
              {live && ` · ${t('refreshingLive')}`}
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-ghost btn-sm" onClick={copy} disabled={!logs?.length}>
              {copied ? t('copied') : t('copy')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>{tc('close')}</button>
          </div>
        </div>
        <div className="modal-body">
          {error && (
            <p className="error">
              {error}
              {error.includes('lease_file_logs') && ` ${t('migrationHint')}`}
            </p>
          )}
          {!logs && !error && <p className="muted">{t('loadingLog')}</p>}
          {logs?.length === 0 && <p className="muted">{t('noEntries')}</p>}
          {logs && logs.length > 0 && (
            <ol className="log-list">
              {logs.map((l) => (
                <li key={l.id} className={`log-entry log-${l.level}`}>
                  <span className="log-time">{formatTime(l.created_at)}</span>
                  <span className={`log-source log-source-${l.source}`}>{l.source === 'function' ? t('sourceServer') : t('sourceBrowser')}</span>
                  <span className="log-step">{l.step}</span>
                  <span className="log-message">
                    {l.message}
                    {l.data && (
                      <button className="link log-data-toggle" onClick={() => toggleData(l.id)}>
                        {openData.has(l.id) ? t('hideDetails') : t('details')}
                      </button>
                    )}
                    {l.data && openData.has(l.id) && <pre className="log-data">{JSON.stringify(l.data, null, 2)}</pre>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
