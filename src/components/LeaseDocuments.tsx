import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { DOC_TYPE_LABELS, openStoredPdf, type Lease, type LeaseFile } from '../lib/leases'

type Props = {
  file: LeaseFile
  allLeases: Lease[]
  filesById: Map<string, LeaseFile>
  onViewText: (lease: Lease) => void
}

const byPage = (a: Lease, b: Lease) => a.page_start - b.page_start

/** The documents found in one uploaded file, with children nested under their main lease. */
export function LeaseDocuments({ file, allLeases, filesById, onViewText }: Props) {
  const inFile = allLeases.filter((l) => l.file_id === file.id).sort(byPage)
  const leasesById = new Map(allLeases.map((l) => [l.id, l]))
  const mains = inFile.filter((l) => l.doc_type === 'main_lease')
  const mainIds = new Set(mains.map((m) => m.id))
  const unattached = inFile.filter((l) => l.doc_type !== 'main_lease' && !(l.parent_id && mainIds.has(l.parent_id)))

  if (!inFile.length) {
    return <p className="muted doc-empty">No documents yet. They appear here once processing finishes.</p>
  }

  return (
    <table className="table doc-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Document</th>
          <th>Pages</th>
          <th>Effective</th>
          <th>Tenant</th>
          <th>Premises</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {mains.map((main) => {
          const children = allLeases
            .filter((l) => l.parent_id === main.id)
            .sort((a, b) => (a.effective_date ?? '').localeCompare(b.effective_date ?? '') || byPage(a, b))
          return (
            <Fragment key={main.id}>
              <LeaseRow lease={main} onViewText={onViewText} />
              {children.map((child) => (
                <LeaseRow
                  key={child.id}
                  lease={child}
                  child
                  note={child.file_id !== file.id ? `from ${filesById.get(child.file_id)?.file_name ?? 'another file'}` : undefined}
                  onViewText={onViewText}
                />
              ))}
            </Fragment>
          )
        })}
        {unattached.map((doc) => {
          const parent = doc.parent_id ? leasesById.get(doc.parent_id) : undefined
          return (
            <LeaseRow
              key={doc.id}
              lease={doc}
              note={parent ? `belongs to ${parent.title}` : doc.doc_type === 'other' ? undefined : 'main lease not found'}
              onViewText={onViewText}
            />
          )
        })}
      </tbody>
    </table>
  )
}

function LeaseRow({
  lease,
  child,
  note,
  onViewText,
}: {
  lease: Lease
  child?: boolean
  note?: string
  onViewText: (lease: Lease) => void
}) {
  const [error, setError] = useState<string | null>(null)

  const openPdf = () => {
    if (!lease.storage_path) return
    setError(null)
    openStoredPdf(lease.storage_path).catch((e) => setError(e.message))
  }

  return (
    <>
      <tr className={child ? 'child-row' : undefined}>
        <td>
          {child && <span className="tree-branch">↳</span>}
          <span className={`badge badge-${lease.doc_type}`}>{DOC_TYPE_LABELS[lease.doc_type]}</span>
        </td>
        <td>
          <div className="doc-title">{lease.title}</div>
          {note && <div className="muted small">{note}</div>}
          {error && <div className="error small">{error}</div>}
        </td>
        <td className="nowrap">
          {lease.page_start === lease.page_end ? `p. ${lease.page_start}` : `p. ${lease.page_start}–${lease.page_end}`}
        </td>
        <td className="nowrap">{lease.effective_date ?? '—'}</td>
        <td>{lease.tenant ?? '—'}</td>
        <td>{lease.premises ?? '—'}</td>
        <td className="actions">
          <Link to={`/leases/${lease.id}`} className="btn btn-ghost btn-sm">Details</Link>
          <button className="btn btn-ghost btn-sm" onClick={() => onViewText(lease)}>Text</button>
          <button className="btn btn-ghost btn-sm" onClick={openPdf} disabled={!lease.storage_path}>PDF</button>
        </td>
      </tr>
    </>
  )
}
