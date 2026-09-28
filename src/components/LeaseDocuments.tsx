import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DOC_TYPE_LABELS, openStoredPdf, type Lease, type LeaseFile } from '../lib/leases'
import { translator, useT } from '../i18n'
import { UploadAmendmentButton } from './UploadAmendment'
import { overview } from '../i18n/messages/overview'
import { details } from '../i18n/messages/details'

export type DocEntry = {
  lease: Lease
  child: boolean
  note?: string
  /** Main leases: number of linked documents (amendments, addenda…) across all files. */
  childCount?: number
  expanded?: boolean
}

const byPage = (a: Lease, b: Lease) => a.page_start - b.page_start

/**
 * The documents found in one uploaded file, in display order: each main lease
 * followed, when it is in `expanded`, by all its amendments/addenda (from any
 * file), then the rest.
 */
export function fileDocuments(
  file: LeaseFile,
  allLeases: Lease[],
  expanded: ReadonlySet<string> = new Set(),
  fileNames: ReadonlyMap<string, string> = new Map(),
): DocEntry[] {
  const inFile = allLeases.filter((l) => l.file_id === file.id).sort(byPage)
  const leasesById = new Map(allLeases.map((l) => [l.id, l]))
  const mains = inFile.filter((l) => l.doc_type === 'main_lease')
  const mainIds = new Set(mains.map((m) => m.id))

  const { t } = translator(details)
  const entries: DocEntry[] = []
  for (const main of mains) {
    const children = allLeases
      .filter((l) => l.parent_id === main.id)
      .sort((a, b) => (a.effective_date ?? '').localeCompare(b.effective_date ?? '') || byPage(a, b))
    const open = expanded.has(main.id)
    entries.push({ lease: main, child: false, childCount: children.length, expanded: open })
    if (!open) continue
    for (const child of children) {
      const elsewhere = child.file_id !== file.id ? fileNames.get(child.file_id) : undefined
      entries.push({ lease: child, child: true, ...(elsewhere ? { note: t('fromFile', { file: elsewhere }) } : {}) })
    }
  }
  for (const doc of inFile) {
    if (doc.doc_type === 'main_lease' || (doc.parent_id && mainIds.has(doc.parent_id))) continue
    const parent = doc.parent_id ? leasesById.get(doc.parent_id) : undefined
    const note = parent ? t('belongsTo', { title: parent.title }) : doc.doc_type === 'other' ? undefined : t('mainLeaseNotFound')
    entries.push({ lease: doc, child: false, note })
  }
  return entries
}

/** The per-document cells of one row in the uploaded files table. */
export function DocumentCells({ entry, onViewText, onToggle, onAmendmentUploaded }: {
  entry: DocEntry
  onViewText: (lease: Lease) => void
  /** Expands or collapses a main lease's linked documents. */
  onToggle?: (leaseId: string) => void
  /** Shows "+ Amendment" on main leases; called after such an upload to reload the list. */
  onAmendmentUploaded?: () => void
}) {
  const { lease, child, note } = entry
  const { t } = useT(details)
  const { t: to } = useT(overview)
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
        <Link to={`/leases/${lease.id}`} className="doc-title doc-link" title={t('openDetails')}>{lease.title}</Link>
        <div className="muted small">
          {lease.page_start === lease.page_end
            ? t('pageSingle', { page: lease.page_start })
            : t('pageRange', { start: lease.page_start, end: lease.page_end })}
          {note && <> · {note}</>}
        </div>

        {error && <div className="error small">{error}</div>}
      </td>
      <td className="nowrap">{lease.effective_date ?? '—'}</td>
      <td>{lease.tenant ?? '—'}</td>
      <td className="premises-cell">{lease.premises ?? '—'}</td>
      <td className="actions doc-actions">
        <div className="doc-actions-row">
          <button className="btn btn-ghost btn-sm" onClick={() => onViewText(lease)}>{t('text')}</button>
          <button className="btn btn-ghost btn-sm" onClick={openPdf} disabled={!lease.storage_path}>{t('pdf')}</button>
        </div>
        {lease.doc_type === 'main_lease' && (
          <Link to={`/leases/${lease.id}/overview`} className="btn btn-ghost btn-sm" title={to('overviewTitle')}>
            {to('overview')}
          </Link>
        )}
        {onToggle && !!entry.childCount && (
          <button
            className={`btn btn-sm doc-toggle${entry.expanded ? ' btn-ghost' : ''}`}
            aria-expanded={!!entry.expanded}
            onClick={() => onToggle(lease.id)}
          >
            <span className={`doc-toggle-icon${entry.expanded ? ' is-open' : ''}`} aria-hidden>▸</span>
            {entry.expanded ? t('hideAmendments') : t('viewAmendments', { count: entry.childCount })}
          </button>
        )}
        {onAmendmentUploaded && lease.doc_type === 'main_lease' && (
          <UploadAmendmentButton lease={lease} compact onDone={onAmendmentUploaded} />
        )}
      </td>
    </>
  )
}
