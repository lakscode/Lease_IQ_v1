import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import {
  CLAUDE_MODELS,
  copyPostgresToMongo,
  fetchClaudeModel,
  fetchDatabaseBackend,
  fetchDatabaseStatus,
  saveClaudeModel,
  saveDatabaseBackend,
  type DatabaseStatus,
} from '../lib/settings'
import { DEFAULT_BACKEND, type DatabaseBackend } from '../lib/db'
import { buildSearchIndex } from '../lib/leases'
import { useDialog } from '../components/Dialog'
import { useT } from '../i18n'
import { settingsPage } from '../i18n/messages/settingsPage'
import { common } from '../i18n/messages/common'

function ModelSettings() {
  const { t } = useT(settingsPage)
  const { t: tc } = useT(common)
  const [saved, setSaved] = useState<string | null>(null)
  const [selected, setSelected] = useState(CLAUDE_MODELS[0].id)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchClaudeModel()
      .then((model) => {
        setSaved(model)
        if (model) setSelected(model)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await saveClaudeModel(selected)
      setSaved(selected)
      setMessage(t('modelSaved'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const option = CLAUDE_MODELS.find((m) => m.id === selected)
  const unknownSaved = saved && !CLAUDE_MODELS.some((m) => m.id === saved)

  return (
    <section className="card settings-section">
      <h2>{t('aiModel')}</h2>
      <div className="settings-row">
        <div>
          <div className="doc-title">{t('claudeModel')}</div>
          <p className="muted">
            {t('modelUsedFor')}{' '}
            {saved ? '' : t('noModelSaved')}
          </p>
        </div>
        <div className="model-picker">
          <select
            className="select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={loading || saving}
            aria-label={t('claudeModel')}
          >
            {unknownSaved && <option value={saved}>{saved}</option>}
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={save} disabled={loading || saving || selected === saved}>
            {saving ? tc('saving') : tc('save')}
          </button>
        </div>
      </div>
      {option && (
        <p className="muted small">
          <code>{option.id}</code> · {option.note}
        </p>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export function Settings() {
  const dialog = useDialog()
  const { t } = useT(settingsPage)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recreateClauses = async () => {
    const ok = await dialog.confirm({
      title: t('recreateConfirmTitle'),
      message: t('recreateConfirmMessage'),
      confirmLabel: t('recreateTable'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setMessage(null)
    setError(null)
    const { error } = await db.rpc('recreate_lease_clauses')
    setBusy(false)
    if (error) {
      console.error('[settings] recreate lease_clauses: failed', error)
      setError(error.message)
    } else {
      setMessage(t('recreated'))
    }
  }

  return (
    <main className="container">
      <h1>{t('title')}</h1>

      <ModelSettings />

      <DatabaseBackendSettings />

      <SearchIndexSettings />

      <section className="card settings-section">
        <h2>{t('database')}</h2>
        <div className="settings-row">
          <div>
            <div className="doc-title">{t('recreateTitle')}</div>
            <p className="muted">{t('recreateText')}</p>
          </div>
          <button className="btn btn-danger nowrap" onClick={recreateClauses} disabled={busy}>
            {busy ? t('recreating') : t('recreateTable')}
          </button>
        </div>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  )
}

/** Backfills the semantic search index (Voyage AI + MongoDB Atlas) for the signed-in user's files. */
function SearchIndexSettings() {
  const { t } = useT(settingsPage)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const build = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const result = await buildSearchIndex()
      if (!result.enabled) setError(t('searchNotConfigured'))
      else setMessage(t('indexBuilt', { files: result.files, chunks: result.chunks }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <section className="card settings-section">
      <h2>{t('searchSection')}</h2>
      <div className="settings-row">
        <div>
          <div className="doc-title">{t('searchIndexTitle')}</div>
          <p className="muted">{t('searchIndexText')}</p>
        </div>
        <button className="btn nowrap" onClick={build} disabled={busy}>
          {busy ? t('indexing') : t('buildIndex')}
        </button>
      </div>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

/** Chooses the database every lease query goes to (Postgres or MongoDB) and copies Postgres data to MongoDB. */
function DatabaseBackendSettings() {
  const dialog = useDialog()
  const { t } = useT(settingsPage)
  const { t: tc } = useT(common)
  const [saved, setSaved] = useState<DatabaseBackend | null>(null)
  const [selected, setSelected] = useState<DatabaseBackend>(DEFAULT_BACKEND)
  const [status, setStatus] = useState<DatabaseStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const names: Record<DatabaseBackend, string> = { postgres: t('dbPostgres'), mongodb: t('dbMongo') }

  useEffect(() => {
    fetchDatabaseBackend()
      .then((backend) => {
        setSaved(backend)
        setSelected(backend)
      })
      .catch((e) => setError(e.message))
    fetchDatabaseStatus()
      .then(setStatus)
      .catch((e) => setStatusError(e.message))
  }, [])

  const mongoReady = !!status?.connected
  const busy = saving || copying || saved === null

  const save = async () => {
    const ok = await dialog.confirm({
      title: t('dbSwitchTitle', { name: names[selected] }),
      message: t('dbSwitchMessage', { name: names[selected] }),
      confirmLabel: t('dbSwitch'),
    })
    if (!ok) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await saveDatabaseBackend(selected)
      setSaved(selected)
      setMessage(t('dbSaved', { name: names[selected] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    if (!status) return
    const ok = await dialog.confirm({ title: t('dbCopyConfirmTitle'), message: t('dbCopyConfirmMessage'), confirmLabel: t('dbCopy') })
    if (!ok) return
    setCopying(true)
    setMessage(null)
    setError(null)
    try {
      const rows = await copyPostgresToMongo(status.tables, (table, n) => setProgress(t('dbCopying', { table, rows: n })))
      setMessage(t('dbCopied', { rows }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
      setCopying(false)
    }
  }

  const mongoStatus = statusError
    ? t('dbStatusFailed', { error: statusError })
    : !status
      ? t('dbChecking')
      : !status.mongodbConfigured
        ? t('dbMongoNotConfigured')
        : status.connected
          ? t('dbMongoConnected')
          : t('dbMongoUnreachable', { error: status.error ?? '' })

  return (
    <section className="card settings-section">
      <h2>{t('dbEngine')}</h2>
      <div className="settings-row">
        <div>
          <div className="doc-title">{t('dbEngineTitle')}</div>
          <p className="muted">{t('dbEngineText')}</p>
        </div>
        <div className="model-picker">
          <select
            className="select"
            value={selected}
            onChange={(e) => setSelected(e.target.value as DatabaseBackend)}
            disabled={busy}
            aria-label={t('dbEngineTitle')}
          >
            <option value="postgres">{names.postgres}</option>
            <option value="mongodb" disabled={!mongoReady && saved !== 'mongodb'}>
              {names.mongodb}
            </option>
          </select>
          <button
            className="btn btn-sm"
            onClick={save}
            disabled={busy || selected === saved || (selected === 'mongodb' && !mongoReady)}
          >
            {saving ? tc('saving') : tc('save')}
          </button>
        </div>
      </div>
      <p className={`small ${status?.connected ? 'success' : 'muted'}`}>{mongoStatus}</p>

      <div className="settings-row">
        <div>
          <div className="doc-title">{t('dbCopyTitle')}</div>
          <p className="muted">{t('dbCopyText')}</p>
        </div>
        <button className="btn nowrap" onClick={copy} disabled={busy || !mongoReady}>
          {copying ? t('dbCopyingShort') : t('dbCopy')}
        </button>
      </div>
      {progress && <p className="muted small">{progress}</p>}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
