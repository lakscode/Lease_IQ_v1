import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function Settings() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recreateClauses = async () => {
    if (
      !confirm(
        'Recreate the lease_clauses table? All clauses are deleted for every user. Re-analyze files to repopulate them.',
      )
    ) {
      return
    }
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
