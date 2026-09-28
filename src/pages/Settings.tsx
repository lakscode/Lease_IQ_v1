import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CLAUDE_MODELS, fetchClaudeModel, saveClaudeModel } from '../lib/settings'
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
    const { error } = await supabase.rpc('recreate_lease_clauses')
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
