import { useEffect, useState } from 'react'
import { fetchLeaseEdits, fieldLabel, type LeaseEdit } from '../lib/leases'
import { formatDateTime, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { details } from '../i18n/messages/details'

function Value({ v }: { v: string | null }) {
  const { t } = useT(details)
  return v ? <span className="history-value" title={v}>{v}</span> : <span className="muted">{t('empty')}</span>
}

/** Every hand edit of a document's details, newest first. `version` changes reload it. */
export function LeaseHistory({ leaseId, version }: { leaseId: string; version: string | null }) {
  const { t } = useT(details)
  const { t: tc } = useT(common)
  const [edits, setEdits] = useState<LeaseEdit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLeaseEdits(leaseId).then(setEdits, (e) => setError(e.message))
  }, [leaseId, version])

  if (error) return <p className="error small">{t('historyError', { error })}</p>
  if (!edits) return <p className="muted small">{tc('loading')}</p>
  if (!edits.length) return <p className="muted panel-empty">{t('noEdits')}</p>

  return (
    <table className="panel-table">
      <thead>
        <tr>
          <th>{t('colWhen')}</th>
          <th>{t('colField')}</th>
          <th>{t('colChange')}</th>
          <th>{t('colBy')}</th>
        </tr>
      </thead>
      <tbody>
        {edits.map((e) => (
          <tr key={e.id}>
            <td className="nowrap small">{formatDateTime(e.created_at)}</td>
            <td className="panel-label">{fieldLabel(e.field)}</td>
            <td className="history-change">
              <del><Value v={e.old_value} /></del>
              <span aria-hidden> → </span>
              <ins><Value v={e.new_value} /></ins>
            </td>
            <td className="small">{e.edited_by_email ?? <span className="muted">{t('system')}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
