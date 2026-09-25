import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CLAUDE_MODELS, fetchClaudeModel, saveClaudeModel } from '../lib/settings'
import { useDialog } from '../components/Dialog'

function ModelSettings() {
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
      setMessage('Saved. New analyses and chat questions use this model.')
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
      <h2>AI model</h2>
      <div className="settings-row">
        <div>
          <div className="doc-title">Claude model</div>
          <p className="muted">
            Used for lease analysis and Ask LeaseIQ.{' '}
            {saved ? '' : 'None saved yet, so the default from the Edge Function config is used.'}
          </p>
        </div>
        <div className="model-picker">
          <select
            className="select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={loading || saving}
            aria-label="Claude model"
          >
            {unknownSaved && <option value={saved}>{saved}</option>}
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={save} disabled={loading || saving || selected === saved}>
            {saving ? 'Saving…' : 'Save'}
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
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recreateClauses = async () => {
    const ok = await dialog.confirm({
      title: 'Recreate the lease_clauses table?',
      message: 'All clauses are deleted for every user. Re-analyze files to classify their clauses again.',
      confirmLabel: 'Recreate table',
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
      setMessage('lease_clauses was recreated. Re-analyze files to classify their clauses again.')
    }
  }

  return (
    <main className="container">
      <h1>Settings</h1>

      <ModelSettings />

      <section className="card settings-section">
        <h2>Database</h2>
        <div className="settings-row">
          <div>
            <div className="doc-title">Recreate lease_clauses table</div>
            <p className="muted">
              Drops the table and creates it again with its index and access policy. Use this if the
              table is missing or broken. Every stored clause is deleted.
            </p>
          </div>
          <button className="btn btn-danger nowrap" onClick={recreateClauses} disabled={busy}>
            {busy ? 'Recreating…' : 'Recreate table'}
          </button>
        </div>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  )
}
