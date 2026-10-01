import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../lib/db'
import { DOC_TYPE_LABELS, type Lease } from '../lib/leases'
import {
  deleteImport,
  detectColumns,
  downloadCsvTemplate,
  IMPORT_FIELDS,
  listImports,
  matchLease,
  parseCsv,
  saveImport,
  SOURCE_LABELS,
  toRecords,
  type ColumnMap,
  type DataImport,
  type FieldKey,
  type ImportSource,
} from '../lib/imports'
import { useDialog } from '../components/Dialog'
import { formatDateTime, formatNumber, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { importPage } from '../i18n/messages/import'

type ImportKey = keyof typeof importPage.en

// Message keys for each source's export instructions.
const SOURCE_GUIDES: Record<ImportSource, { title: ImportKey; steps: ImportKey[]; note?: ImportKey }> = {
  yardi: {
    title: 'yardiTitle',
    steps: ['yardiStep1', 'yardiStep2', 'yardiStep3', 'yardiStep4', 'yardiStep5'],
    note: 'yardiNote',
  },
  mri: {
    title: 'mriTitle',
    steps: ['mriStep1', 'mriStep2', 'mriStep3', 'mriStep4', 'mriStep5'],
    note: 'mriNote',
  },
  csv: {
    title: 'csvTitle',
    steps: ['csvStep1', 'csvStep2', 'csvStep3', 'csvStep4'],
  },
}

/** Renders a translated sentence with one {placeholder} replaced by a React node. */
function withNode(text: string, placeholder: string, node: ReactNode) {
  const [before, after = ''] = text.split(`{${placeholder}}`)
  return (
    <>
      {before}
      {node}
      {after}
    </>
  )
}

type Parsed = {
  fileName: string
  rows: string[][]
  headerRow: number
  map: ColumnMap
}

export function Import() {
  const dialog = useDialog()
  const { t, tp } = useT(importPage)
  const { t: tc } = useT(common)
  const [source, setSource] = useState<ImportSource>('yardi')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [leases, setLeases] = useState<Lease[]>([])
  const [overrides, setOverrides] = useState<Record<number, string>>({})
  const [imports, setImports] = useState<DataImport[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    db
      .from('leases')
      .select('*')
      .order('title')
      .then(({ data }) => setLeases((data as Lease[]) ?? []))
    listImports().then(setImports, (e) => setError(e.message))
  }, [])

  const headers = parsed ? parsed.rows[parsed.headerRow] : []
  const records = useMemo(() => (parsed ? toRecords(parsed.rows, parsed.headerRow, parsed.map) : []), [parsed])
  const matches = useMemo(() => records.map((r) => matchLease(r, leases)), [records, leases])
  const matchedId = (i: number) => (i in overrides ? overrides[i] || null : matches[i]?.id ?? null)
  const leasesById = useMemo(() => new Map(leases.map((l) => [l.id, l])), [leases])

  const chooseSource = (s: ImportSource) => {
    setSource(s)
    setParsed(null)
    setOverrides({})
    setMessage(null)
    setError(null)
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setMessage(null)
    setError(null)
    setOverrides({})
    if (!/\.csv$/i.test(file.name)) {
      setError(t('notCsv'))
      return
    }
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      setError(t('noDataRows'))
      return
    }
    const { headerRow, map } = detectColumns(rows, source)
    setParsed({ fileName: file.name, rows, headerRow, map })
    if (inputRef.current) inputRef.current.value = ''
  }

  const setColumn = (key: FieldKey, value: string) => {
    if (!parsed) return
    const map = { ...parsed.map }
    if (value === '') delete map[key]
    else map[key] = Number(value)
    setParsed({ ...parsed, map })
  }

  const runImport = async () => {
    if (!parsed) return
    setSaving(true)
    setError(null)
    try {
      const columnMap = Object.fromEntries(Object.entries(parsed.map).map(([k, i]) => [k, headers[i!] ?? `Column ${i! + 1}`]))
      const imp = await saveImport(
        source,
        parsed.fileName,
        columnMap,
        records.map((r, i) => ({ ...r, matched_lease_id: matchedId(i) })),
      )
      setImports((list) => [imp, ...list])
      setParsed(null)
      setOverrides({})
      setMessage(tp('imported', imp.row_count, { file: imp.file_name, matched: formatNumber(imp.matched_count) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const removeImport = async (imp: DataImport) => {
    const ok = await dialog.confirm({
      title: t('deleteTitle'),
      message: withNode(tp('deleteMessage', imp.row_count), 'file', <strong>{imp.file_name}</strong>),
      confirmLabel: tc('delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteImport(imp.id)
      setImports((list) => list.filter((x) => x.id !== imp.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const guide = SOURCE_GUIDES[source]
  const missingTenant = parsed && parsed.map.tenant === undefined
  const matchedCount = records.filter((_, i) => matchedId(i)).length

  return (
    <main className="container wide">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>

      <div className="import-tabs" role="tablist">
        {(['yardi', 'mri', 'csv'] as ImportSource[]).map((s) => (
          <button key={s} role="tab" aria-selected={source === s} className={`import-tab${source === s ? ' active' : ''}`} onClick={() => chooseSource(s)}>
            {SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="import-grid">
        <section className="card">
          <h2 className="import-heading">{t(guide.title)}</h2>
          <ol className="import-steps">
            {guide.steps.map((step) => (
              <li key={step}>{t(step)}</li>
            ))}
          </ol>
          {source === 'csv' && (
            <button className="btn btn-ghost btn-sm" onClick={downloadCsvTemplate}>
              {t('downloadTemplate')}
            </button>
          )}
          {guide.note && <p className="muted small">{t(guide.note)}</p>}
          <div className="import-upload">
            <button className="btn" onClick={() => inputRef.current?.click()}>
              {t(source === 'csv' ? 'uploadCsvFile' : 'uploadExport', { source: SOURCE_LABELS[source] })}
            </button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          </div>
        </section>

        <section className="card">
          <h2 className="import-heading">{t('dataWeUse')}</h2>
          <table className="panel-table import-fields">
            <thead>
              <tr>
                <th>{t('colField')}</th>
                <th>{source === 'csv' ? t('colTemplate') : t('colTypical', { source: SOURCE_LABELS[source] })}</th>
              </tr>
            </thead>
            <tbody>
              {IMPORT_FIELDS.filter((f) => source !== 'csv' || f.template).map((f) => (
                <tr key={f.key}>
                  <td>
                    <span className="panel-strong">{f.label}</span>
                    {f.required && <span className="import-required"> {t('required')}</span>}
                    <div className="muted small">{f.description}</div>
                  </td>
                  <td className="small">{source === 'csv' ? f.template?.heading : f.aliases[source].slice(0, 3).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {parsed && (
        <section className="card import-preview">
          <div className="section-header import-preview-head">
            <div>
              <h2>{parsed.fileName}</h2>
              <p className="muted small">
                {tp('previewSummary', records.length, { matched: formatNumber(matchedCount), row: formatNumber(parsed.headerRow + 1) })}
              </p>
            </div>
            <div className="section-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setParsed(null)} disabled={saving}>
                {tc('cancel')}
              </button>
              <button className="btn btn-sm" onClick={runImport} disabled={saving || !!missingTenant || !records.length}>
                {saving ? t('importing') : tp('importRecords', records.length)}
              </button>
            </div>
          </div>

          <h3 className="cam-heading">{t('columns')}</h3>
          {missingTenant && <p className="error small">{t('chooseTenantColumn')}</p>}
          <div className="import-mapping">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key}>
                <span>
                  {f.label}
                  {f.required && ' *'}
                </span>
                <select className="select" value={parsed.map[f.key] ?? ''} onChange={(e) => setColumn(f.key, e.target.value)}>
                  <option value="">{t('notInFile')}</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || t('columnN', { n: i + 1 })}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <h3 className="cam-heading">{t('records')}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('colTenant')}</th>
                  <th>{t('colUnit')}</th>
                  <th>{t('colLeaseDates')}</th>
                  <th className="panel-num">{t('colArea')}</th>
                  <th className="panel-num">{t('colBaseRent')}</th>
                  <th className="panel-num">{t('colCamTaxIns')}</th>
                  <th className="panel-num">{t('colDeposit')}</th>
                  <th>{t('colMatchedLease')}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i}>
                    <td className="doc-title">
                      {r.tenant}
                      {r.external_id && <div className="muted small">{r.external_id}</div>}
                    </td>
                    <td>{[r.property, r.unit].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="nowrap small">
                      {r.lease_start ?? '—'} → {r.lease_end ?? '—'}
                    </td>
                    <td className="panel-num">{r.area_sqft != null ? formatNumber(r.area_sqft) : '—'}</td>
                    <td className="panel-num">{r.monthly_base_rent != null ? formatNumber(r.monthly_base_rent, { style: 'currency', currency: 'USD' }) : '—'}</td>
                    <td className="panel-num small">
                      {[r.cam_monthly, r.tax_monthly, r.insurance_monthly].map((v) => (v === null ? '—' : formatNumber(v))).join(' / ')}
                    </td>
                    <td className="panel-num">{r.security_deposit != null ? formatNumber(r.security_deposit) : '—'}</td>
                    <td>
                      <select
                        className={`select${matchedId(i) ? '' : ' import-unmatched'}`}
                        value={matchedId(i) ?? ''}
                        onChange={(e) => setOverrides((o) => ({ ...o, [i]: e.target.value }))}
                        aria-label={t('leaseFor', { tenant: r.tenant })}
                      >
                        <option value="">{t('notMatched')}</option>
                        {leases.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.title} ({DOC_TYPE_LABELS[l.doc_type]})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="section-header">
        <h2>{t('pastImports')}</h2>
      </div>
      {imports.length === 0 ? (
        <p className="muted">{t('nothingImported')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('colFile')}</th>
                <th>{t('colSource')}</th>
                <th className="panel-num">{t('colRecords')}</th>
                <th className="panel-num">{t('colMatched')}</th>
                <th>{t('colImported')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id}>
                  <td className="doc-title">{imp.file_name}</td>
                  <td>
                    <span className="badge">{SOURCE_LABELS[imp.source]}</span>
                  </td>
                  <td className="panel-num">{formatNumber(imp.row_count)}</td>
                  <td className="panel-num">{formatNumber(imp.matched_count)}</td>
                  <td className="nowrap">{formatDateTime(imp.created_at)}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm danger" onClick={() => removeImport(imp)}>
                      {tc('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {withNode(
          t('footer'),
          'link',
          <Link to="/leases" className="link">
            {t('footerLink')}
          </Link>,
        )}
      </p>
    </main>
  )
}
