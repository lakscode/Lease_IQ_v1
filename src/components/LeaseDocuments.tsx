import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DOC_TYPE_LABELS, openStoredPdf, type Lease, type LeaseFile } from '../lib/leases'

export type DocEntry = { lease: Lease; child: boolean; note?: string }

const byPage = (a: Lease, b: Lease) => a.page_start - b.page_start

/**
 * The documents found in one uploaded file, in display order: each main lease
 * followed by its amendments/addenda from the same file, then the rest.
 */
export function fileDocuments(file: LeaseFile, allLeases: Lease[]): DocEntry[] {
  const inFile = allLeases.filter((l) => l.file_id === file.id).sort(byPage)
  const leasesById = new Map(allLeases.map((l) => [l.id, l]))
  const mains = inFile.filter((l) => l.doc_type === 'main_lease')
  const mainIds = new Set(mains.map((m) => m.id))

  const entries: DocEntry[] = []
  for (const main of mains) {
    entries.push({ lease: main, child: false })
    inFile
      .filter((l) => l.parent_id === main.id)
      .sort((a, b) => (a.effective_date ?? '').localeCompare(b.effective_date ?? '') || byPage(a, b))
      .forEach((child) => entries.push({ lease: child, child: true }))
  }
  for (const doc of inFile) {
    if (doc.doc_type === 'main_lease' || (doc.parent_id && mainIds.has(doc.parent_id))) continue
    const parent = doc.parent_id ? leasesById.get(doc.parent_id) : undefined
    const note = parent ? `belongs to ${parent.title}` : doc.doc_type === 'other' ? undefined : 'main lease not found'
    entries.push({ lease: doc, child: false, note })
  }
  return entries
}

/** The per-document cells of one row in the uploaded files table. */
export function DocumentCells({ entry, onViewText }: { entry: DocEntry; onViewText: (lease: Lease) => void }) {
  const { lease, child, note } = entry
  const [error, setError] = useState<string | null>(null)

  const openPdf = () => {
    if (!lease.storage_path) return
    setError(null)
    openStoredPdf(lease.storage_path).catch((e) => setError(e.message))
  }

  return (
    <>
      <td className={child ? 'child-cell' : undefined}>
        {child && <span className="tree-branch">↳</span>}
        <span className={`badge badge-${lease.doc_type}`}>{DOC_TYPE_LABELS[lease.doc_type]}</span>
      </td>
      <td>
        <Link to={`/leases/${lease.id}`} className="doc-title doc-link" title="Open details">{lease.title}</Link>
        <div className="muted small">
          {lease.page_start === lease.page_end ? `p. ${lease.page_start}` : `p. ${lease.page_start}–${lease.page_end}`}
          {note && <> · {note}</>}
        </div>
        {error && <div className="error small">{error}</div>}
      </td>
      <td className="nowrap">{lease.effective_date ?? '—'}</td>
      <td>{lease.tenant ?? '—'}</td>
      <td className="premises-cell">{lease.premises ?? '—'}</td>
      <td className="actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onViewText(lease)}>Text</button>
        <button className="btn btn-ghost btn-sm" onClick={openPdf} disabled={!lease.storage_path}>PDF</button>
      </td>
    </>
  )
}
