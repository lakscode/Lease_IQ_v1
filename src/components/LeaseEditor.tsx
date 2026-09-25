import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { EDITABLE_SECTIONS, fieldValue, updateLeaseDetails, type EditableField, type Lease } from '../lib/leases'

type Key = EditableField['key']

/** Modal form for correcting a document's details. Only changed fields are saved (and recorded in its history). */
export function LeaseEditor({ lease, onClose, onSaved }: { lease: Lease; onClose: () => void; onSaved: (lease: Lease) => void }) {
  const sections = useMemo(
    () =>
      EDITABLE_SECTIONS.map((s) => ({
        ...s,
        fields: s.fields.filter((f) => f.key !== 'abstract.changes_made' || lease.doc_type !== 'main_lease'),
      })),
    [lease.doc_type],
  )
  const initial = useMemo(
    () => Object.fromEntries(sections.flatMap((s) => s.fields.map((f) => [f.key, fieldValue(lease, f.key)]))) as Record<Key, string>,
    [sections, lease],
  )
  const [values, setValues] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = (Object.keys(values) as Key[]).filter((k) => values[k].trim() !== initial[k].trim())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onSaved(await updateLeaseDetails(lease, Object.fromEntries(changed.map((k) => [k, values[k]]))))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={save} role="dialog" aria-label={`Edit ${lease.title}`}>
        <div className="modal-header">
          <h3>Edit details</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
        <div className="modal-body lease-edit">
          {sections.map((s) => (
            <fieldset key={s.title}>
              <legend>{s.title}</legend>
              {s.fields.map((f) => {
                const props = {
                  value: values[f.key],
                  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [f.key]: e.target.value })),
                  disabled: saving,
                }
                return (
                  <label key={f.key} className={changed.includes(f.key) ? 'lease-edit-changed' : undefined}>
                    {f.label}
                    {f.kind === 'long' ? <textarea rows={3} {...props} /> : <input type={f.kind === 'date' ? 'date' : 'text'} {...props} />}
                  </label>
                )
              })}
            </fieldset>
          ))}
        </div>
        <div className="modal-footer">
          {error && <span className="error small">{error}</span>}
          <span className="muted small">
            {changed.length ? `${changed.length} field${changed.length === 1 ? '' : 's'} changed` : 'No changes'} · changes are kept in the edit history
          </span>
          <button type="submit" className="btn btn-sm" disabled={saving || !changed.length}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
