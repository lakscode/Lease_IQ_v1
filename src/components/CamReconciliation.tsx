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
import { formatDate, formatNumber, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { camReconciliation } from '../i18n/messages/camReconciliation'

type NumberField = Exclude<keyof CamInputs, 'capAppliesTo'>

// Labels and hints are the `${field}` and `${field}Hint` keys of the camReconciliation messages.
const EXPENSE_FIELDS = [
  'totalExpenses',
  'excludedExpenses',
  'variableExpenses',
  'occupancyPercent',
  'controllableExpenses',
  'baseYearExpenses',
  'priorYearCapBase',
  'estimatesPaid',
] as const satisfies readonly NumberField[]

const RATE_FIELDS = ['proRataPercent', 'adminFeePercent', 'grossUpPercent', 'capPercent'] as const satisfies readonly NumberField[]

/** The lease's CAM terms, and a calculator for each year's reconciliation. */
export function CamReconciliation({ familyId, terms, ready }: { familyId: string; terms: CamTerms | null; ready: boolean }) {
  const dialog = useDialog()
  const { t, tp } = useT(camReconciliation)
  const { t: tc } = useT(common)
  const pct = (n: number) => (n >= 0 ? t('percent', { value: formatNumber(n) }) : null)
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
    setMessage(t('loaded', { year: r.year }))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const row = await saveReconciliation(familyId, year, inputs, notes)
      setSaved((list) => [row, ...list.filter((r) => r.year !== row.year)].sort((a, b) => b.year - a.year))
      setMessage(t('saved', { year }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: SavedReconciliation) => {
    const ok = await dialog.confirm({
      title: t('deleteTitle', { year: r.year }),
      message: t('deleteMessage'),
      confirmLabel: tc('delete'),
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
        [t('termProRata'), [pct(terms.pro_rata_share_percent), terms.share_basis].filter(Boolean).join(' · ') || null],
        [t('termRecoverable'), terms.recoverable_items || null],
        [t('termExclusions'), terms.exclusions || null],
        [
          t('termAdminFee'),
          terms.admin_fee_percent >= 0
            ? t(
                terms.admin_fee_basis === 'total_expenses' ? 'adminFeeOfTotal' : terms.admin_fee_basis === 'tenant_share' ? 'adminFeeOfShare' : 'percent',
                { value: formatNumber(terms.admin_fee_percent) },
              )
            : null,
        ],
        [
          t('termCap'),
          terms.cap_percent >= 0
            ? [
                pct(terms.cap_percent),
                terms.cap_type === 'not_stated' ? null : t(`capType_${terms.cap_type}`),
                terms.cap_applies_to === 'controllable' ? t('capControllableOnly') : null,
                terms.cap_terms,
              ]
                .filter(Boolean)
                .join(' · ')
            : terms.cap_terms || null,
        ],
        [t('termGrossUp'), pct(terms.gross_up_percent)],
        [t('termBaseYear'), terms.base_year || null],
        [t('termExpenseYear'), terms.expense_year || null],
        [t('termEstimates'), terms.estimate_payments || null],
        [t('termStatementDue'), terms.reconciliation_deadline || null],
        [t('termAuditRights'), terms.audit_rights || null],
      ]
    : []

  return (
    <div className="cam">
      <div className="cam-grid">
        <section>
          <h3 className="cam-heading">{t('termsHeading')}</h3>
          {!ready ? (
            <p className="muted small">{t('clickGenerate')}</p>
          ) : !terms ? (
            <p className="muted small">{t('noTerms')}</p>
          ) : !terms.has_cam ? (
            <p className="muted small">{t('noCam')}</p>
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
                      {t('citation', { title: c.title, page: c.page })}
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <h3 className="cam-heading">
            {t('reconciliationFor')
              .split(/(\{year\})/)
              .map((part, i) =>
                part === '{year}' ? (
                  <input
                    key={i}
                    className="cam-year"
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value) || year)}
                    aria-label={t('yearAria')}
                  />
                ) : (
                  part
                ),
              )}
          </h3>
          <div className="cam-fields">
            {EXPENSE_FIELDS.map((field) => (
              <label key={field} title={t(`${field}Hint`)}>
                <span>{t(field)}</span>
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
            {RATE_FIELDS.map((field) => (
              <label key={field}>
                <span>{t(field)}</span>
                <input inputMode="decimal" value={inputs[field] ?? ''} onChange={(e) => setNumber(field, e.target.value)} placeholder="%" />
              </label>
            ))}
            <label>
              <span>{t('capAppliesTo')}</span>
              <select
                className="select"
                value={inputs.capAppliesTo}
                onChange={(e) => setInputs((c) => ({ ...c, capAppliesTo: e.target.value as CamInputs['capAppliesTo'] }))}
              >
                <option value="all">{t('allExpenses')}</option>
                <option value="controllable">{t('controllableOnly')}</option>
              </select>
            </label>
          </div>
          <p className="muted small">{t('ratesNote')}</p>
        </section>
      </div>

      {hasAmounts && (
        <div className="cam-result">
          <table className="panel-table">
            <tbody>
              <tr><td>{t('recoverableExpenses')}</td><td className="panel-num">{money(result.recoverable)}</td></tr>
              {result.grossUpAdjustment > 0 && <tr><td>{t('grossUpAdjustment')}</td><td className="panel-num">+ {money(result.grossUpAdjustment)}</td></tr>}
              {result.baseYearDeduction > 0 && <tr><td>{t('lessBaseYear')}</td><td className="panel-num">− {money(result.baseYearDeduction)}</td></tr>}
              <tr><td>{t('tenantShare', { value: formatNumber(inputs.proRataPercent ?? 0) })}</td><td className="panel-num">{money(result.tenantShare)}</td></tr>
              {result.adminFee > 0 && <tr><td>{t('adminFee', { value: formatNumber(inputs.adminFeePercent ?? 0) })}</td><td className="panel-num">+ {money(result.adminFee)}</td></tr>}
              {result.capReduction > 0 && (
                <tr><td>{t('capReduction', { limit: money(result.capLimit ?? 0) })}</td><td className="panel-num">− {money(result.capReduction)}</td></tr>
              )}
              <tr className="usage-total"><td>{t('camDueFor', { year })}</td><td className="panel-num">{money(result.totalDue)}</td></tr>
              <tr><td>{t('estimatesPaid')}</td><td className="panel-num">− {money(result.estimatesPaid)}</td></tr>
              <tr className={`usage-total ${result.balance > 0 ? 'cam-owed' : 'cam-credit'}`}>
                <td>{result.balance > 0 ? t('tenantOwes') : result.balance < 0 ? t('creditDue') : t('balance')}</td>
                <td className="panel-num">{money(Math.abs(result.balance))}</td>
              </tr>
            </tbody>
          </table>
          {deadline && (
            <p className={`small ${deadline < new Date() ? 'error' : 'muted'}`}>
              {tp('statementDueBy', terms?.reconciliation_deadline_days ?? 0, { date: formatDate(deadline) })}
            </p>
          )}
          <div className="cam-save">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} aria-label={t('notes')} />
            <button className="btn btn-sm" onClick={save} disabled={saving}>
              {saving ? tc('saving') : saved.some((r) => r.year === year) ? t('updateYear', { year }) : t('saveYear', { year })}
            </button>
          </div>
        </div>
      )}
      {message && <p className="success small">{message}</p>}
      {error && <p className="error small">{error}</p>}

      {saved.length > 0 && (
        <>
          <h3 className="cam-heading">{t('savedHeading')}</h3>
          <table className="panel-table">
            <thead>
              <tr>
                <th>{t('colYear')}</th>
                <th className="panel-num">{t('colCamDue')}</th>
                <th className="panel-num">{t('estimatesPaid')}</th>
                <th className="panel-num">{t('balance')}</th>
                <th>{t('notes')}</th>
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
                    {r.result.balance > 0
                      ? t('owes', { amount: money(r.result.balance) })
                      : r.result.balance < 0
                        ? t('credit', { amount: money(-r.result.balance) })
                        : money(0)}
                  </td>
                  <td className="small">{r.notes ?? ''}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => load(r)}>{t('open')}</button>
                    <button className="btn btn-ghost btn-sm danger" onClick={() => remove(r)}>{tc('delete')}</button>
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
