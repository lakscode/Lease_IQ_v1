import { useEffect, useState } from 'react'
import { fetchLeaseEdits, fieldLabel, type LeaseEdit } from '../lib/leases'

const Value = ({ v }: { v: string | null }) =>
  v ? <span className="history-value" title={v}>{v}</span> : <span className="muted">empty</span>

/** Every hand edit of a document's details, newest first. `version` changes reload it. */
export function LeaseHistory({ leaseId, version }: { leaseId: string; version: string | null }) {
  const [edits, setEdits] = useState<LeaseEdit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLeaseEdits(leaseId).then(setEdits, (e) => setError(e.message))
  }, [leaseId, version])

  if (error) return <p className="error small">Could not load the edit history: {error}</p>
  if (!edits) return <p className="muted small">Loading…</p>
  if (!edits.length) return <p className="muted panel-empty">No edits yet. Details are as extracted by the AI analysis.</p>

  return (
    <table className="panel-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Field</th>
          <th>Change</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        {edits.map((e) => (
          <tr key={e.id}>
            <td className="nowrap small">{new Date(e.created_at).toLocaleString()}</td>
            <td className="panel-label">{fieldLabel(e.field)}</td>
            <td className="history-change">
              <del><Value v={e.old_value} /></del>
              <span aria-hidden> → </span>
              <ins><Value v={e.new_value} /></ins>
            </td>
            <td className="small">{e.edited_by_email ?? <span className="muted">system</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
