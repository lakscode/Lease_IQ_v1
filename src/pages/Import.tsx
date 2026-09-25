import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
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

const SOURCE_GUIDES: Record<ImportSource, { title: string; steps: string[]; note?: string }> = {
  yardi: {
    title: 'Export a rent roll from Yardi Voyager',
    steps: [
      'In Yardi Voyager (Commercial), open Reports and run the Commercial Rent Roll (or "Rent Roll with Lease Charges") report.',
      'Select the property or property list and today\'s date as the "As of" date. Include current and future leases.',
      'Include the lease charges: base rent (e.g. rnt), CAM, real estate tax and insurance. They can be columns, or one row per charge code; both are supported.',
      'Include the security deposit and the future rent / rent steps if your report layout offers them.',
      'Export to Excel, then in Excel choose File → Save As → CSV (Comma delimited) and upload the CSV here.',
    ],
    note: 'A live connection to Yardi (Voyager web services) needs an interface licence and credentials from Yardi; file export works with any Yardi setup.',
  },
  mri: {
    title: 'Export a rent roll from MRI',
    steps: [
      'In MRI Commercial Management, open Reports and run the Rent Roll (or Tenancy Schedule) report.',
      'Select the buildings (Bldg Id) and today\'s date as the as-of date. Include current and future leases.',
      'Include recurring charges by income category: base rent (e.g. RNT), CAM, RET (real estate tax) and INS. Columns or one row per income category both work.',
      'Include the security deposit and next rent step if available.',
      'Export to Excel, then in Excel choose File → Save As → CSV (Comma delimited) and upload the CSV here.',
    ],
    note: 'A live connection to MRI (MRI Open API) needs API credentials from MRI; file export works with any MRI setup.',
  },
  csv: {
    title: 'Upload a CSV rent roll',
    steps: [
      'Download the template below and fill in one row per lease. Keep the header row.',
      'Only Tenant is required; fill in as many other columns as you have. Amounts are monthly unless the column says otherwise.',
      'Dates can be YYYY-MM-DD or MM/DD/YYYY. Amounts can include $ and commas.',
      'Save as CSV (UTF-8) and upload it here.',
    ],
  },
}

type Parsed = {
  fileName: string
  rows: string[][]
  headerRow: number
  map: ColumnMap
}

export function Import() {
  const dialog = useDialog()
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
    supabase
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
      setError('Please upload a .csv file. For an Excel export, open it in Excel and use File → Save As → CSV.')
      return
    }
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      setError('The file has no data rows.')
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
      setMessage(`Imported ${imp.row_count} lease record(s) from ${imp.file_name}; ${imp.matched_count} matched to leases in LeaseIQ.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const removeImport = async (imp: DataImport) => {
    const ok = await dialog.confirm({
      title: 'Delete this import?',
      message: (
        <>
          The {imp.row_count} record(s) imported from <strong>{imp.file_name}</strong> will be deleted.
        </>
      ),
      confirmLabel: 'Delete',
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
      <h1>Import data</h1>
      <p className="muted">
        Import your rent roll from a property management system or a CSV file. Each record is matched to a lease in LeaseIQ, so
        the system's rent, dates, charges and deposits can be compared with the lease on its Details page and used when
        generating revenue and risk opportunities.
      </p>

      <div className="import-tabs" role="tablist">
        {(['yardi', 'mri', 'csv'] as ImportSource[]).map((s) => (
          <button key={s} role="tab" aria-selected={source === s} className={`import-tab${source === s ? ' active' : ''}`} onClick={() => chooseSource(s)}>
            {SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="import-grid">
        <section className="card">
          <h2 className="import-heading">{guide.title}</h2>
          <ol className="import-steps">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {source === 'csv' && (
            <button className="btn btn-ghost btn-sm" onClick={downloadCsvTemplate}>
              ⬇ Download CSV template
            </button>
          )}
          {guide.note && <p className="muted small">{guide.note}</p>}
          <div className="import-upload">
            <button className="btn" onClick={() => inputRef.current?.click()}>
              Upload {SOURCE_LABELS[source]} {source === 'csv' ? 'file' : 'export (CSV)'}
            </button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          </div>
        </section>

        <section className="card">
          <h2 className="import-heading">Data we use</h2>
          <table className="panel-table import-fields">
            <thead>
              <tr>
                <th>Field</th>
                <th>{source === 'csv' ? 'Template column' : `Typical ${SOURCE_LABELS[source]} column`}</th>
              </tr>
            </thead>
            <tbody>
              {IMPORT_FIELDS.filter((f) => source !== 'csv' || f.template).map((f) => (
                <tr key={f.key}>
                  <td>
                    <span className="panel-strong">{f.label}</span>
                    {f.required && <span className="import-required"> required</span>}
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
                {records.length} lease record(s) found · {matchedCount} matched to leases · header on row {parsed.headerRow + 1}
              </p>
            </div>
            <div className="section-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setParsed(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-sm" onClick={runImport} disabled={saving || !!missingTenant || !records.length}>
                {saving ? 'Importing…' : `Import ${records.length} record(s)`}
              </button>
            </div>
          </div>

          <h3 className="cam-heading">Columns</h3>
          {missingTenant && <p className="error small">Choose which column holds the tenant name.</p>}
          <div className="import-mapping">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key}>
                <span>
                  {f.label}
                  {f.required && ' *'}
                </span>
                <select className="select" value={parsed.map[f.key] ?? ''} onChange={(e) => setColumn(f.key, e.target.value)}>
                  <option value="">— not in file —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <h3 className="cam-heading">Records</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Unit</th>
                  <th>Lease dates</th>
                  <th className="panel-num">Area</th>
                  <th className="panel-num">Base rent / mo</th>
                  <th className="panel-num">CAM / tax / ins</th>
                  <th className="panel-num">Deposit</th>
                  <th>Matched lease</th>
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
                    <td className="panel-num">{r.area_sqft?.toLocaleString() ?? '—'}</td>
                    <td className="panel-num">{r.monthly_base_rent?.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) ?? '—'}</td>
                    <td className="panel-num small">
                      {[r.cam_monthly, r.tax_monthly, r.insurance_monthly].map((v) => (v === null ? '—' : v.toLocaleString())).join(' / ')}
                    </td>
                    <td className="panel-num">{r.security_deposit?.toLocaleString() ?? '—'}</td>
                    <td>
                      <select
                        className={`select${matchedId(i) ? '' : ' import-unmatched'}`}
                        value={matchedId(i) ?? ''}
                        onChange={(e) => setOverrides((o) => ({ ...o, [i]: e.target.value }))}
                        aria-label={`Lease for ${r.tenant}`}
                      >
                        <option value="">Not matched</option>
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
        <h2>Past imports</h2>
      </div>
      {imports.length === 0 ? (
        <p className="muted">Nothing imported yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Source</th>
                <th className="panel-num">Records</th>
                <th className="panel-num">Matched</th>
                <th>Imported</th>
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
                  <td className="panel-num">{imp.row_count}</td>
                  <td className="panel-num">{imp.matched_count}</td>
                  <td className="nowrap">{new Date(imp.created_at).toLocaleString()}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm danger" onClick={() => removeImport(imp)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Matched records appear on each lease's <Link to="/leases" className="link">Details page</Link> under System records.
      </p>
    </main>
  )
}
