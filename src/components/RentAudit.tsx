import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { money } from '../lib/cam'
import { fetchSystemLease, SOURCE_LABELS, type SavedSystemLease } from '../lib/imports'
import {
  billingChecks,
  calculateRentAudit,
  defaultRange,
  deleteRentAudit,
  listRentAudits,
  monthsBetween,
  saveRentAudit,
  type RentAuditInputs,
  type RentTerms,
  type SavedRentAudit,
} from '../lib/rentAudit'
import { useDialog } from './Dialog'
import { formatDate, formatNumber, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { rentAudit } from '../i18n/messages/rentAudit'

const MONTH_RE = /^\d{4}-\d{2}$/

const monthLabel = (month: string) => formatDate(`${month}-01T00:00:00`, { month: 'short', year: 'numeric' })
const dayLabel = (iso: string) => formatDate(`${iso}T00:00:00`)

const parseAmount = (raw: string) => {
  if (raw.trim() === '') return null
  const n = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isNaN(n) ? null : n
}

/** The lease's base rent schedule, a check against the system record, and a month-by-month audit of billed rent. */
export function RentAudit({ familyId, familyIds, terms, ready }: { familyId: string; familyIds: string[]; terms: RentTerms | null; ready: boolean }) {
  const dialog = useDialog()
  const { t, tp } = useT(rentAudit)
  const { t: tc } = useT(common)
  const [inputs, setInputs] = useState<RentAuditInputs>(() => ({ ...defaultRange(terms), billed: {} }))
  const [fill, setFill] = useState('')
  const [notes, setNotes] = useState('')
  const [system, setSystem] = useState<SavedSystemLease | null>(null)
  const [saved, setSaved] = useState<SavedRentAudit[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = familyIds.join(',')

  useEffect(() => {
    listRentAudits(familyId).then(setSaved, (e) => setError(e.message))
  }, [familyId])

  useEffect(() => {
    fetchSystemLease(ids ? ids.split(',') : []).then(setSystem, () => setSystem(null))
  }, [ids])

  // The range follows the schedule once its terms load (or are regenerated).
  useEffect(() => {
    setInputs((current) => ({ ...current, ...defaultRange(terms) }))
  }, [terms])

  // The system's monthly base rent is the default amount to fill in.
  useEffect(() => {
    if (system?.monthly_base_rent != null) setFill((f) => f || String(system.monthly_base_rent))
  }, [system])

  const validRange = MONTH_RE.test(inputs.startMonth) && MONTH_RE.test(inputs.endMonth) && inputs.startMonth <= inputs.endMonth
  const result = useMemo(() => (terms && validRange ? calculateRentAudit(terms, inputs) : null), [terms, inputs, validRange])
  const checks = useMemo(() => (terms && system ? billingChecks(terms, system) : []), [terms, system])
  const auditable = ready && terms?.has_rent && terms.steps.length > 0

  const setRange = (field: 'startMonth' | 'endMonth', value: string) => {
    setInputs((c) => ({ ...c, [field]: value }))
    setMessage(null)
  }

  const setBilled = (month: string, raw: string) => {
    setInputs((c) => ({ ...c, billed: { ...c.billed, [month]: parseAmount(raw) } }))
    setMessage(null)
  }

  const fillAll = () => {
    const value = parseAmount(fill)
    if (!validRange) return
    setInputs((c) => ({
      ...c,
      billed: { ...c.billed, ...Object.fromEntries(monthsBetween(c.startMonth, c.endMonth).map((m) => [m, value])) },
    }))
    setMessage(null)
  }

  const load = (a: SavedRentAudit) => {
    setInputs(a.inputs)
    setNotes(a.notes ?? '')
    setMessage(t('loaded', { start: monthLabel(a.start_month), end: monthLabel(a.end_month) }))
  }

  const save = async () => {
    if (!terms) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const row = await saveRentAudit(familyId, terms, inputs, notes)
      setSaved((list) =>
        [row, ...list.filter((a) => a.id !== row.id)].sort(
          (a, b) => b.end_month.localeCompare(a.end_month) || b.start_month.localeCompare(a.start_month),
        ),
      )
      setMessage(t('saved'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (a: SavedRentAudit) => {
    const ok = await dialog.confirm({
      title: t('deleteTitle', { start: monthLabel(a.start_month), end: monthLabel(a.end_month) }),
      message: t('deleteMessage'),
      confirmLabel: tc('delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteRentAudit(a.id)
      setSaved((list) => list.filter((x) => x.id !== a.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const checkValue = (key: string, v: number | string | null) =>
    v === null ? <span className="muted">—</span> : key === 'nextDate' ? dayLabel(String(v)) : money(Number(v))

  const isCurrentRange = (a: SavedRentAudit) => a.start_month === inputs.startMonth && a.end_month === inputs.endMonth
  const hasBilled = result?.lines.some((l) => l.billed !== null)

  return (
    <div className="cam">
      <div className="cam-grid">
        <section>
          <h3 className="cam-heading">{t('scheduleHeading')}</h3>
          {!ready ? (
            <p className="muted small">{t('clickGenerate')}</p>
          ) : !terms ? (
            <p className="muted small">{t('noTerms')}</p>
          ) : !terms.has_rent || !terms.steps.length ? (
            <p className="muted small">{t('noRent')}</p>
          ) : (
            <>
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>{t('colPeriod')}</th>
                    <th className="panel-num">{t('colMonthly')}</th>
                  </tr>
                </thead>
                <tbody>
                  {terms.steps.map((s) => (
                    <tr key={s.start_date}>
                      <td>
                        {s.end_date ? t('periodRange', { start: dayLabel(s.start_date), end: dayLabel(s.end_date) }) : t('periodFrom', { start: dayLabel(s.start_date) })}
                        {s.description && <div className="muted small">{s.description}</div>}
                      </td>
                      <td className="panel-num">{money(s.monthly_rent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {terms.abatements.length > 0 && (
                <table className="panel-table">
                  <tbody>
                    {terms.abatements.map((a) => (
                      <tr key={a.start_date}>
                        <td className="panel-label">{t('abatement', { value: formatNumber(a.percent) })}</td>
                        <td>
                          {a.end_date ? t('periodRange', { start: dayLabel(a.start_date), end: dayLabel(a.end_date) }) : t('periodFrom', { start: dayLabel(a.start_date) })}
                          {a.description && <div className="muted small">{a.description}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <table className="panel-table">
                <tbody>
                  {(
                    [
                      [t('termEscalations'), terms.escalation_terms],
                      [t('termPayment'), terms.payment_terms],
                      [t('termLateFees'), terms.late_fee_terms],
                    ] as const
                  ).map(([label, value]) => (
                    <tr key={label}>
                      <td className="panel-label">{label}</td>
                      <td>{value || <span className="muted">—</span>}</td>
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
          <h3 className="cam-heading">{t('billingHeading')}</h3>
          {!auditable ? (
            <p className="muted small">{t('billingNeedsSchedule')}</p>
          ) : !system ? (
            <p className="muted small">
              {t('noSystem')} <Link to="/import" className="link">{t('importLink')}</Link>
            </p>
          ) : (
            <>
              <table className="panel-table">
                <thead>
                  <tr>
                    <th />
                    <th className="panel-num">{t('colLease')}</th>
                    <th className="panel-num">{SOURCE_LABELS[system.source]}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.key}>
                      <td className="panel-label">{t(`check_${c.key}`)}</td>
                      <td className="panel-num">{checkValue(c.key, c.lease)}</td>
                      <td className="panel-num">{checkValue(c.key, c.system)}</td>
                      <td className={`small ${c.status === 'mismatch' ? 'cam-owed' : c.status === 'match' ? 'cam-credit' : 'muted'}`}>
                        {t(`status_${c.status}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">{t('checkNote')}</p>
            </>
          )}
        </section>
      </div>

      {auditable && (
        <>
          <h3 className="cam-heading">{t('auditHeading')}</h3>
          <div className="cam-fields">
            <label>
              <span>{t('fromMonth')}</span>
              <input type="month" value={inputs.startMonth} onChange={(e) => setRange('startMonth', e.target.value)} />
            </label>
            <label>
              <span>{t('toMonth')}</span>
              <input type="month" value={inputs.endMonth} onChange={(e) => setRange('endMonth', e.target.value)} />
            </label>
            <label title={t('fillHint')}>
              <span>{t('fillAmount')}</span>
              <input inputMode="decimal" value={fill} onChange={(e) => setFill(e.target.value)} placeholder="$" />
            </label>
            <label>
              <span>&nbsp;</span>
              <button className="btn btn-ghost btn-sm" onClick={fillAll} disabled={!validRange || parseAmount(fill) === null}>
                {t('fillAll')}
              </button>
            </label>
          </div>
          {!validRange && <p className="error small">{t('invalidRange')}</p>}

          {result && (
            <div className="rent-audit-table">
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>{t('colMonth')}</th>
                    <th className="panel-num">{t('colLeaseRent')}</th>
                    <th className="panel-num">{t('colBilled')}</th>
                    <th className="panel-num">{t('colVariance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={l.month}>
                      <td>{monthLabel(l.month)}</td>
                      <td className="panel-num" title={l.abatement > 0 ? t('abatedTitle', { scheduled: money(l.scheduled), abatement: money(l.abatement) }) : undefined}>
                        {money(l.expected)}
                        {l.abatement > 0 && <div className="muted small">{t('abated', { amount: money(l.abatement) })}</div>}
                      </td>
                      <td className="panel-num">
                        <input
                          className="rent-audit-input"
                          inputMode="decimal"
                          value={inputs.billed[l.month] ?? ''}
                          onChange={(e) => setBilled(l.month, e.target.value)}
                          placeholder="$"
                          aria-label={t('billedAria', { month: monthLabel(l.month) })}
                        />
                      </td>
                      <td className={`panel-num ${l.variance === null || l.variance === 0 ? 'muted' : l.variance < 0 ? 'cam-owed' : 'cam-credit'}`}>
                        {l.variance === null ? '—' : l.variance === 0 ? money(0) : l.variance < 0 ? `− ${money(-l.variance)}` : `+ ${money(l.variance)}`}
                      </td>
                    </tr>
                  ))}
                  <tr className="usage-total">
                    <td>{t('total')}</td>
                    <td className="panel-num">{money(result.totalExpected)}</td>
                    <td className="panel-num">{money(result.totalBilled)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {result && hasBilled && (
            <div className="cam-result">
              <table className="panel-table">
                <tbody>
                  <tr><td>{t('underBilled')}</td><td className="panel-num cam-owed">{money(result.underBilled)}</td></tr>
                  <tr><td>{t('overBilled')}</td><td className="panel-num cam-credit">{money(result.overBilled)}</td></tr>
                  <tr className={`usage-total ${result.net > 0 ? 'cam-owed' : 'cam-credit'}`}>
                    <td>{result.net > 0 ? t('tenantOwes') : result.net < 0 ? t('creditDue') : t('balance')}</td>
                    <td className="panel-num">{money(Math.abs(result.net))}</td>
                  </tr>
                </tbody>
              </table>
              {result.monthsMissing > 0 && <p className="muted small">{tp('monthsMissing', result.monthsMissing)}</p>}
              <div className="cam-save">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} aria-label={t('notes')} />
                <button className="btn btn-sm" onClick={save} disabled={saving}>
                  {saving ? tc('saving') : saved.some(isCurrentRange) ? t('updateAudit') : t('saveAudit')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {message && <p className="success small">{message}</p>}
      {error && <p className="error small">{error}</p>}

      {saved.length > 0 && (
        <>
          <h3 className="cam-heading">{t('savedHeading')}</h3>
          <table className="panel-table">
            <thead>
              <tr>
                <th>{t('colPeriod')}</th>
                <th className="panel-num">{t('colLeaseRent')}</th>
                <th className="panel-num">{t('colBilled')}</th>
                <th className="panel-num">{t('balance')}</th>
                <th>{t('notes')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {saved.map((a) => (
                <tr key={a.id}>
                  <td className="panel-strong">{t('periodRange', { start: monthLabel(a.start_month), end: monthLabel(a.end_month) })}</td>
                  <td className="panel-num">{money(a.result.totalExpected)}</td>
                  <td className="panel-num">{money(a.result.totalBilled)}</td>
                  <td className={`panel-num ${a.result.net > 0 ? 'cam-owed' : 'cam-credit'}`}>
                    {a.result.net > 0 ? t('owes', { amount: money(a.result.net) }) : a.result.net < 0 ? t('credit', { amount: money(-a.result.net) }) : money(0)}
                  </td>
                  <td className="small">{a.notes ?? ''}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => load(a)}>{t('open')}</button>
                    <button className="btn btn-ghost btn-sm danger" onClick={() => remove(a)}>{tc('delete')}</button>
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
