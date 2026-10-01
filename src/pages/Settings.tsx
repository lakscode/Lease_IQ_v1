import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db } from '../lib/db'
import {
  CLAUDE_MODELS,
  copyPostgresToMongo,
  fetchClaudeModel,
  fetchDatabaseBackend,
  fetchDatabaseStatus,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  saveClaudeModel,
  saveDatabaseBackend,
  type AppUser,
  type UserRole,
  type DatabaseStatus,
} from '../lib/settings'
import { DEFAULT_BACKEND, type DatabaseBackend } from '../lib/db'
import { buildSearchIndex } from '../lib/leases'
import { useDialog } from '../components/Dialog'
import { formatDate, formatDateTime, useT } from '../i18n'
import { useAuth } from '../lib/AuthProvider'
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
  const { t } = useT(settingsPage)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'users' ? 'users' : 'general'

  return (
    <main className="container">
      <h1>{t('title')}</h1>

      <div className="import-tabs" role="tablist">
        {(['general', 'users'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`import-tab${tab === key ? ' active' : ''}`}
            onClick={() => setParams(key === 'general' ? {} : { tab: key }, { replace: true })}
          >
            {key === 'general' ? t('tabGeneral') : t('tabUsers')}
          </button>
        ))}
      </div>

      {tab === 'users' ? <UsersSettings /> : <GeneralSettings />}
    </main>
  )
}

function GeneralSettings() {
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
    <>
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
    </>
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

/** Every registered account: add, edit (email, role, password) and delete them. */
function UsersSettings() {
  const dialog = useDialog()
  const { session } = useAuth()
  const { t } = useT(settingsPage)
  const { t: tc } = useT(common)
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // null: closed; 'new': adding; a user: editing that user.
  const [editing, setEditing] = useState<AppUser | 'new' | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const myId = session?.user.id

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (users ?? []).filter((u) => !q || (u.email ?? '').toLowerCase().includes(q))
  }, [users, query])
  const admins = (users ?? []).filter((u) => u.role === 'superadmin').length

  const saved = (user: AppUser, added: boolean) => {
    setUsers((list) => [user, ...(list ?? []).filter((u) => u.id !== user.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    setEditing(null)
    setError(null)
    setMessage(t(added ? 'userAdded' : 'userSaved', { email: user.email ?? '' }))
  }

  const remove = async (user: AppUser) => {
    const ok = await dialog.confirm({
      title: t('userDeleteTitle'),
      message: t('userDeleteMessage', { email: user.email ?? user.id }),
      confirmLabel: t('userDelete'),
      danger: true,
    })
    if (!ok) return
    setDeleting(user.id)
    setMessage(null)
    setError(null)
    try {
      await deleteUser(user.id)
      setUsers((list) => (list ?? []).filter((u) => u.id !== user.id))
      setMessage(t('userDeleted', { email: user.email ?? '' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <section className="card settings-section">
      <div className="settings-row">
        <h2>{t('usersTitle')}</h2>
        <button className="btn btn-sm" onClick={() => setEditing('new')} disabled={!users}>
          {t('userAdd')}
        </button>
      </div>
      <div className="settings-row">
        <p className="muted">{users ? t('usersSummary', { total: users.length, admins }) : error ? '' : t('usersLoading')}</p>
        <input type="search" placeholder={t('usersSearch')} aria-label={t('usersSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      {users && (
        <div className="table-wrap flush">
          <table className="table">
            <thead>
              <tr>
                <th>{t('usersEmail')}</th>
                <th>{t('usersRole')}</th>
                <th>{t('usersJoined')}</th>
                <th>{t('usersLastSignIn')}</th>
                <th aria-label={t('usersActions')} />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email ?? <span className="muted">—</span>}
                    {u.id === myId && <span className="muted small"> ({t('usersYou')})</span>}
                    {!u.confirmed && <span className="badge badge-pending badge-inline">{t('usersUnconfirmed')}</span>}
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'superadmin' ? 'nav-role' : 'badge-pending'}`}>
                      {u.role === 'superadmin' ? tc('superAdmin') : t('usersRoleUser')}
                    </span>
                  </td>
                  <td className="nowrap">{formatDate(u.created_at)}</td>
                  <td className="nowrap">{u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : <span className="muted">{t('usersNever')}</span>}</td>
                  <td className="nowrap">
                    <div className="model-picker">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)} disabled={deleting === u.id}>
                        {t('userEdit')}
                      </button>
                      {u.id !== myId && (
                        <button className="btn btn-ghost btn-sm danger" onClick={() => remove(u)} disabled={deleting === u.id}>
                          {deleting === u.id ? t('userDeleting') : t('userDelete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t('usersNone')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.id === myId}
          onSaved={saved}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

/** Add or edit form, shown as a dialog. */
function UserForm({
  user,
  isSelf,
  onSaved,
  onClose,
}: {
  user: AppUser | null
  isSelf: boolean
  onSaved: (user: AppUser, added: boolean) => void
  onClose: () => void
}) {
  const { t } = useT(settingsPage)
  const { t: tc } = useT(common)
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>(user?.role ?? 'user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = user
        ? await updateUser(user.id, {
            email: email.trim() !== user.email ? email.trim() : undefined,
            role: role !== user.role ? role : undefined,
            password: password || undefined,
          })
        : await createUser(email.trim(), password, role)
      onSaved(result, !user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog user-form" role="dialog" aria-modal="true" aria-labelledby="user-form-title" onSubmit={submit}>
        <h3 id="user-form-title">{user ? t('userEditTitle') : t('userAddTitle')}</h3>
        <label>
          {t('usersEmail')}
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {user ? t('userNewPassword') : t('userPassword')}
          <input
            type="password"
            required={!user}
            minLength={6}
            autoComplete="new-password"
            placeholder={user ? t('userPasswordKeep') : ''}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {t('usersRole')}
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={isSelf}>
            <option value="user">{t('usersRoleUser')}</option>
            <option value="superadmin">{tc('superAdmin')}</option>
          </select>
          {isSelf && <span className="muted small">{t('userOwnRole')}</span>}
        </label>
        {!user && <p className="muted small">{t('userAddNote')}</p>}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? tc('saving') : user ? tc('save') : t('userAdd')}
          </button>
        </div>
      </form>
    </div>
  )
}
