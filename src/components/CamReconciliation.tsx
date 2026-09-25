import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  calculateCam,
  defaultInputs,
  deleteReconciliation,
  listReconciliations,
  money,
  saveReconciliation,
  statementDeadline,
  type CamInputs,
  type CamReconciliation as SavedReconciliation,
  type CamTerms,
} from '../lib/cam'
import { useDialog } from './Dialog'

type NumberField = Exclude<keyof CamInputs, 'capAppliesTo'>

const EXPENSE_FIELDS: Array<[NumberField, string, string]> = [
  ['totalExpenses', 'Total operating expenses', 'All CAM / operating expenses for the year'],
  ['excludedExpenses', 'Excluded expenses', 'Items the lease excludes from recovery'],
  ['variableExpenses', 'Variable expenses', 'Part that varies with occupancy (for gross-up)'],
  ['occupancyPercent', 'Average occupancy %', 'Building occupancy for the year (for gross-up)'],
  ['controllableExpenses', 'Controllable expenses', 'For caps on controllable expenses only'],
  ['baseYearExpenses', 'Base year expenses', 'Only if the tenant pays increases over a base year'],
  ['priorYearCapBase', 'Prior-year capped amount', "Tenant's capped charge the cap grows from"],
  ['estimatesPaid', 'Estimates paid', 'CAM estimates the tenant paid during the year'],
]

const RATE_FIELDS: Array<[NumberField, string]> = [
  ['proRataPercent', 'Pro-rata share %'],
  ['adminFeePercent', 'Admin fee %'],
  ['grossUpPercent', 'Gross-up to %'],
  ['capPercent', 'Cap %'],
]

const pct = (n: number) => (n >= 0 ? `${n}%` : null)

/** The lease's CAM terms, and a calculator for each year's reconciliation. */
export function CamReconciliation({ familyId, terms, ready }: { familyId: string; terms: CamTerms | null; ready: boolean }) {
  const dialog = useDialog()
  const [year, setYear] = useState(new Date().getFullYear() - 1)
  const [inputs, setInputs] = useState<CamInputs>(() => defaultInputs(terms))
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState<SavedReconciliation[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listReconciliations(familyId).then(setSaved, (e) => setError(e.message))
  }, [familyId])

  // Rates come from the lease once its terms load (or are regenerated).
  useEffect(() => {
    setInputs((current) => {
      const rates = defaultInputs(terms)
      return { ...current, proRataPercent: rates.proRataPercent, adminFeePercent: rates.adminFeePercent, grossUpPercent: rates.grossUpPercent, capPercent: rates.capPercent, capAppliesTo: rates.capAppliesTo }
    })
  }, [terms])

  const result = useMemo(() => calculateCam(inputs), [inputs])
  const deadline = statementDeadline(terms, year)
  const hasAmounts = inputs.totalExpenses !== null

  const setNumber = (field: NumberField, raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw.replace(/[$,%\s]/g, ''))
    setInputs((current) => ({ ...current, [field]: value === null || Number.isNaN(value) ? null : value }))
    setMessage(null)
  }

  const load = (r: SavedReconciliation) => {
    setYear(r.year)
    setInputs(r.inputs)
    setNotes(r.notes ?? '')
    setMessage(`Loaded the ${r.year} reconciliation.`)
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const row = await saveReconciliation(familyId, year, inputs, notes)
      setSaved((list) => [row, ...list.filter((r) => r.year !== row.year)].sort((a, b) => b.year - a.year))
      setMessage(`Saved the ${year} reconciliation.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: SavedReconciliation) => {
    const ok = await dialog.confirm({
      title: `Delete the ${r.year} reconciliation?`,
      message: "The saved figures for this year will be deleted. This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteReconciliation(r.id)
      setSaved((list) => list.filter((x) => x.id !== r.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const termRows: Array<[string, string | null]> = terms
    ? [
        ['Pro-rata share', [pct(terms.pro_rata_share_percent), terms.share_basis].filter(Boolean).join(' · ') || null],
        ['Recoverable', terms.recoverable_items || null],
        ['Exclusions', terms.exclusions || null],
        ['Admin fee', terms.admin_fee_percent >= 0 ? `${terms.admin_fee_percent}%${terms.admin_fee_basis === 'total_expenses' ? ' of total expenses' : terms.admin_fee_basis === 'tenant_share' ? " of tenant's share" : ''}` : null],
        ['Cap', terms.cap_percent >= 0 ? [`${terms.cap_percent}%`, terms.cap_type.replace('_', '-'), terms.cap_applies_to === 'controllable' ? 'controllable only' : null, terms.cap_terms].filter((x) => x && x !== 'not-stated').join(' · ') : terms.cap_terms || null],
        ['Gross-up', pct(terms.gross_up_percent)],
        ['Base year / stop', terms.base_year || null],
        ['Expense year', terms.expense_year || null],
        ['Estimates', terms.estimate_payments || null],
        ['Statement due', terms.reconciliation_deadline || null],
        ['Audit rights', terms.audit_rights || null],
      ]
    : []

  return (
    <div className="cam">
      <div className="cam-grid">
        <section>
          <h3 className="cam-heading">Lease CAM terms</h3>
          {!ready ? (
            <p className="muted small">Click Generate above to extract the CAM terms from the lease and its amendments.</p>
          ) : !terms ? (
            <p className="muted small">No CAM terms yet. Click Refresh above to extract them.</p>
          ) : !terms.has_cam ? (
            <p className="muted small">This lease family does not charge CAM or operating expenses.</p>
          ) : (
            <>
              <table className="panel-table">
                <tbody>
                  {termRows.map(([label, value]) => (
                    <tr key={label}>
                      <td className="panel-label">{label}</td>
                      <td>{value ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {terms.citations.length > 0 && (
                <div className="insight-meta small">
                  {terms.citations.map((c) => (
                    <Link key={`${c.leaseId}:${c.page}`} to={`/leases/${c.leaseId}`} className="chat-source" title={c.title}>
                      {c.title}, p. {c.page}
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <h3 className="cam-heading">
            Reconciliation for{' '}
            <input
              className="cam-year"
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              aria-label="Reconciliation year"
            />
          </h3>
          <div className="cam-fields">
            {EXPENSE_FIELDS.map(([field, label, hint]) => (
              <label key={field} title={hint}>
                <span>{label}</span>
                <input
                  inputMode="decimal"
                  value={inputs[field] ?? ''}
                  onChange={(e) => setNumber(field, e.target.value)}
                  placeholder={field === 'occupancyPercent' ? '%' : '$'}
                />
              </label>
            ))}
          </div>
          <div className="cam-fields cam-rates">
            {RATE_FIELDS.map(([field, label]) => (
              <label key={field}>
                <span>{label}</span>
                <input inputMode="decimal" value={inputs[field] ?? ''} onChange={(e) => setNumber(field, e.target.value)} placeholder="%" />
              </label>
            ))}
            <label>
              <span>Cap applies to</span>
              <select
                className="select"
                value={inputs.capAppliesTo}
                onChange={(e) => setInputs((c) => ({ ...c, capAppliesTo: e.target.value as CamInputs['capAppliesTo'] }))}
              >
                <option value="all">All expenses</option>
                <option value="controllable">Controllable only</option>
              </select>
            </label>
          </div>
          <p className="muted small">Rates are filled in from the lease; change them if needed.</p>
        </section>
      </div>

      {hasAmounts && (
        <div className="cam-result">
          <table className="panel-table">
            <tbody>
              <tr><td>Recoverable expenses</td><td className="panel-num">{money(result.recoverable)}</td></tr>
              {result.grossUpAdjustment > 0 && <tr><td>Gross-up adjustment</td><td className="panel-num">+ {money(result.grossUpAdjustment)}</td></tr>}
              {result.baseYearDeduction > 0 && <tr><td>Less base year expenses</td><td className="panel-num">− {money(result.baseYearDeduction)}</td></tr>}
              <tr><td>Tenant share ({inputs.proRataPercent ?? 0}%)</td><td className="panel-num">{money(result.tenantShare)}</td></tr>
              {result.adminFee > 0 && <tr><td>Admin fee ({inputs.adminFeePercent}%)</td><td className="panel-num">+ {money(result.adminFee)}</td></tr>}
              {result.capReduction > 0 && (
                <tr><td>Cap reduction (limit {money(result.capLimit ?? 0)})</td><td className="panel-num">− {money(result.capReduction)}</td></tr>
              )}
              <tr className="usage-total"><td>CAM due for {year}</td><td className="panel-num">{money(result.totalDue)}</td></tr>
              <tr><td>Estimates paid</td><td className="panel-num">− {money(result.estimatesPaid)}</td></tr>
              <tr className={`usage-total ${result.balance > 0 ? 'cam-owed' : 'cam-credit'}`}>
                <td>{result.balance > 0 ? 'Tenant owes' : result.balance < 0 ? 'Credit due to tenant' : 'Balance'}</td>
                <td className="panel-num">{money(Math.abs(result.balance))}</td>
              </tr>
            </tbody>
          </table>
          {deadline && (
            <p className={`small ${deadline < new Date() ? 'error' : 'muted'}`}>
              Statement due to the tenant by {deadline.toLocaleDateString()} ({terms?.reconciliation_deadline_days} days after year end).
            </p>
          )}
          <div className="cam-save">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" />
            <button className="btn btn-sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : saved.some((r) => r.year === year) ? `Update ${year}` : `Save ${year}`}
            </button>
          </div>
        </div>
      )}
      {message && <p className="success small">{message}</p>}
      {error && <p className="error small">{error}</p>}

      {saved.length > 0 && (
        <>
          <h3 className="cam-heading">Saved reconciliations</h3>
          <table className="panel-table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="panel-num">CAM due</th>
                <th className="panel-num">Estimates paid</th>
                <th className="panel-num">Balance</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id}>
                  <td className="panel-strong">{r.year}</td>
                  <td className="panel-num">{money(r.result.totalDue)}</td>
                  <td className="panel-num">{money(r.result.estimatesPaid)}</td>
                  <td className={`panel-num ${r.result.balance > 0 ? 'cam-owed' : 'cam-credit'}`}>
                    {r.result.balance > 0 ? 'Owes ' : r.result.balance < 0 ? 'Credit ' : ''}
                    {money(Math.abs(r.result.balance))}
                  </td>
                  <td className="small">{r.notes ?? ''}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => load(r)}>Open</button>
                    <button className="btn btn-ghost btn-sm danger" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
