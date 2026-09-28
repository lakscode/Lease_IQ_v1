import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Lease } from '../lib/leases'
import { daysFromToday, leaseTerms } from '../lib/leaseStatus'
import { formatDate, formatNumber, useT } from '../i18n'
import { dashboard } from '../i18n/messages/dashboard'
import { common } from '../i18n/messages/common'

type Tile = [label: string, value: number | undefined, hint?: string, tone?: string]

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section className="stats">
      {tiles.map(([label, value, hint, tone]) => (
        <div key={label} className={`card stat${tone ? ` stat-${tone}` : ''}`}>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value ?? '…'}</div>
          {hint && <div className="muted small">{hint}</div>}
        </div>
      ))}
    </section>
  )
}

export function Dashboard() {
  const { session } = useAuth()
  const { t, tp } = useT(dashboard)
  const { t: tc } = useT(common)
  const [files, setFiles] = useState<Array<{ is_scanned: boolean }> | null>(null)
  const [leases, setLeases] = useState<Lease[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([supabase.from('lease_files').select('is_scanned'), supabase.from('leases').select('*')]).then(
      ([filesRes, leasesRes]) => {
        const err = filesRes.error ?? leasesRes.error
        if (err) setError(err.message)
        setFiles(filesRes.data ?? [])
        setLeases(leasesRes.data ?? [])
      },
    )
  }, [])

  const terms = useMemo(() => (leases ? leaseTerms(leases) : null), [leases])
  const expiringSoon = useMemo(
    () => terms?.filter((x) => x.expiringSoon).sort((a, b) => a.expiration!.getTime() - b.expiration!.getTime()) ?? [],
    [terms],
  )

  const count = (type: Lease['doc_type']) => leases?.filter((l) => l.doc_type === type).length
  const unknown = terms?.filter((x) => x.status === 'unknown').length ?? 0

  const statusTiles: Tile[] = [
    [t('activeLeases'), terms?.filter((x) => x.status === 'active').length, t('activeHint'), 'active'],
    [t('renewedLeases'), terms?.filter((x) => x.renewed).length, t('renewedHint'), 'renewed'],
    [t('expiredLeases'), terms?.filter((x) => x.status === 'expired').length, t('expiredHint'), 'expired'],
    [t('expiring12'), terms ? expiringSoon.length : undefined, t('expiring12Hint'), 'soon'],
  ]

  const documentTiles: Tile[] = [
    [t('filesUploaded'), files?.length, files ? t('scannedHint', { count: formatNumber(files.filter((f) => f.is_scanned).length) }) : undefined],
    [t('leaseDocuments'), leases?.length, t('leaseDocumentsHint')],
    [t('mainLeases'), count('main_lease')],
    [t('amendments'), count('amendment')],
    [t('addenda'), count('addendum')],
    [t('commencementLetters'), count('commencement_letter')],
    [t('otherDocuments'), count('other'), t('otherHint')],
  ]

  return (
    <main className="container wide">
      <div className="page-header">
        <div>
          <h1>{t('title')}</h1>
          <p className="muted">{t('signedInAs', { email: session?.user.email ?? '' })}</p>
        </div>
        <Link to="/leases" className="btn">{t('leaseAbstractionLink')}</Link>
      </div>

      {error && <p className="error">{error}</p>}

      <h2 className="section-title">{t('leaseStatus')}</h2>
      <Tiles tiles={statusTiles} />
      {unknown > 0 && (
        <p className="muted small">
          {tp('unknownNote', unknown)}
        </p>
      )}

      <h2 className="section-title">{t('expiringNext12')}</h2>
      {!terms ? (
        <p className="muted">{tc('loading')}</p>
      ) : expiringSoon.length === 0 ? (
        <p className="muted">{t('noneExpiring')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('colLease')}</th>
                <th>{t('colTenant')}</th>
                <th>{t('colPremises')}</th>
                <th>{t('colExpires')}</th>
                <th>{t('colDaysLeft')}</th>
              </tr>
            </thead>
            <tbody>
              {expiringSoon.map((term) => {
                const days = daysFromToday(term.expiration!)
                return (
                  <tr key={term.main.id}>
                    <td>
                      <Link to={`/leases/${term.main.id}`} className="doc-title panel-link">{term.main.title}</Link>
                      {term.renewed && <span className="badge badge-success badge-inline">{t('renewed')}</span>}
                    </td>
                    <td>{term.main.tenant ?? '—'}</td>
                    <td>{term.main.premises ?? '—'}</td>
                    <td className="nowrap">{formatDate(term.expiration!)}</td>
                    <td className={`nowrap${days <= 90 ? ' error' : ''}`}>{days}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">{t('documents')}</h2>
      <Tiles tiles={documentTiles} />
    </main>
  )
}
