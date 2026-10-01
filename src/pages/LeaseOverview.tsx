import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { db } from '../lib/db'
import { ABSTRACT_LABELS, DOC_TYPE_LABELS, type Lease, type LeaseFile } from '../lib/leases'
import { daysFromToday, leaseTerms } from '../lib/leaseStatus'
import { UploadAmendmentButton } from '../components/UploadAmendment'
import { formatDate, useT } from '../i18n'
import { common } from '../i18n/messages/common'
import { overview } from '../i18n/messages/overview'

// Key terms shown "as amended", in display order (keys of lease.abstract).
const TERM_FIELDS = [
  'expiration_date',
  'term',
  'commencement_date',
  'base_rent',
  'rent_escalations',
  'operating_expenses',
  'security_deposit',
  'rentable_area',
  'premises_address',
  'permitted_use',
  'renewal_options',
  'termination_options',
]

const byDate = (a: Lease, b: Lease) => (a.effective_date ?? '').localeCompare(b.effective_date ?? '') || a.page_start - b.page_start

/** A plain YYYY-MM-DD in the app's date format; anything else as written. */
const showDate = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(`${value}T00:00:00Z`, { timeZone: 'UTC', dateStyle: 'medium' }) : value

export function LeaseOverview() {
  const { id } = useParams<{ id: string }>()
  const { t, tp } = useT(overview)
  const { t: tc } = useT(common)
  const [leases, setLeases] = useState<Lease[] | null>(null)
  const [files, setFiles] = useState<LeaseFile[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    Promise.all([db.from('leases').select('*'), db.from('lease_files').select('*')]).then(([leasesRes, filesRes]) => {
      const err = leasesRes.error ?? filesRes.error
      if (err) setError(err.message)
      setLeases(leasesRes.data ?? [])
      setFiles(filesRes.data ?? [])
    })

  useEffect(() => {
    load()
  }, [id])

  // The overview is always of the main lease, also when opened from one of its amendments.
  const opened = leases?.find((l) => l.id === id)
  const main = opened?.parent_id ? leases?.find((l) => l.id === opened.parent_id) ?? opened : opened
  const family = useMemo(
    () => (main && leases ? [main, ...leases.filter((l) => l.parent_id === main.id).sort(byDate)] : []),
    [leases, main],
  )
  const term = useMemo(() => (main ? leaseTerms(family).find((x) => x.main.id === main.id) : undefined), [family, main])

  // Each term from the latest document that states it (later documents override earlier ones).
  const currentTerms = useMemo(
    () =>
      TERM_FIELDS.flatMap((field) => {
        const source = [...family].reverse().find((doc) => doc.abstract?.[field]?.trim())
        return source ? [{ field, value: source.abstract[field]!, source }] : []
      }),
    [family],
  )

  if (!leases) return <main className="container wide"><p className="muted">{tc('loading')}</p></main>
  if (!main) {
    return (
      <main className="container wide">
        <Link to="/leases" className="dash-back">← {tc('navLeases')}</Link>
        <p className="error">{error ?? t('notFound')}</p>
      </main>
    )
  }

  const fileName = (fileId: string) => files.find((f) => f.id === fileId)?.file_name
  const days = term?.expiration ? daysFromToday(term.expiration) : null
  const facts = [
    [ABSTRACT_LABELS.tenant, main.tenant ?? main.abstract?.tenant],
    [ABSTRACT_LABELS.landlord, main.landlord ?? main.abstract?.landlord],
    [ABSTRACT_LABELS.premises_address, main.premises ?? main.abstract?.premises_address],
  ].filter(([, v]) => v) as Array<[string, string]>

  return (
    <main className="container wide">
      <Link to="/leases" className="dash-back">← {tc('navLeases')}</Link>
      <div className="ov-head">
        <div className="ov-head-main">
          <p className="ov-eyebrow">{t('overview')}</p>
          <h1>{main.title}</h1>
          {facts.length > 0 && (
            <dl className="ov-facts">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="ov-head-side">
          <div className={`ov-status ov-status-${term?.status ?? 'unknown'}`}>
            <span className="ov-status-dot" aria-hidden />
            <strong>
              {term?.status === 'active' ? t('statusActive') : term?.status === 'expired' ? t('statusExpired') : t('statusUnknown')}
            </strong>
            {term?.renewed && <span className="badge badge-success">{t('renewed')}</span>}
          </div>
          {term?.expiration && (
            <div className="muted small">
              {t(term.status === 'expired' ? 'expired' : 'expires', { date: formatDate(term.expiration, { dateStyle: 'medium' }) })}
              {days !== null && days >= 0 && <> · {tp('daysLeft', days)}</>}
            </div>
          )}
          <div className="ov-actions">
            <Link to={`/chat?lease=${main.id}`} className="btn btn-sm">{t('askAbout')}</Link>
            <UploadAmendmentButton lease={main} onDone={load} />
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="ov-grid">
        <section className="card ov-card">
          <h2>{t('documents')}</h2>
          <p className="muted small">{tp('documentsSub', family.length)}</p>
          <ol className="ov-timeline">
            {family.map((doc) => {
              const changes = doc.doc_type === 'main_lease' ? null : doc.abstract?.changes_made
              return (
                <li key={doc.id} className={`ov-item ov-item-${doc.doc_type}`}>
                  <span className="ov-node" aria-hidden />
                  <Link to={`/leases/${doc.id}`} className="ov-doc">
                    <div className="ov-doc-top">
                      <span className={`badge badge-${doc.doc_type}`}>{DOC_TYPE_LABELS[doc.doc_type]}</span>
                      <span className="muted small">
                        {doc.effective_date ? t('effective', { date: showDate(doc.effective_date)! }) : t('noDate')}
                      </span>
                    </div>
                    <div className="ov-doc-title">{doc.title}</div>
                    {doc.summary && <p className="ov-doc-summary">{doc.summary}</p>}
                    {changes && (
                      <div className="ov-doc-changes">
                        <span>{t('changes')}</span>
                        {changes}
                      </div>
                    )}
                    <div className="ov-doc-foot muted small">
                      <span>
                        {doc.page_start === doc.page_end
                          ? t('pageSingle', { page: doc.page_start })
                          : t('pageRange', { start: doc.page_start, end: doc.page_end })}
                        {fileName(doc.file_id) && <> · {fileName(doc.file_id)}</>}
                      </span>
                      <span className="ov-doc-open">{t('openDetails')}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>

        <section className="card ov-card">
          <h2>{t('currentTerms')}</h2>
          <p className="muted small">{t('currentTermsSub')}</p>
          {currentTerms.length === 0 ? (
            <p className="muted">{t('noTerms')}</p>
          ) : (
            <table className="table ov-terms">
              <thead>
                <tr>
                  <th>{t('colTerm')}</th>
                  <th>{t('colValue')}</th>
                  <th>{t('colSource')}</th>
                </tr>
              </thead>
              <tbody>
                {currentTerms.map(({ field, value, source }) => (
                  <tr key={field}>
                    <th scope="row">{ABSTRACT_LABELS[field] ?? field}</th>
                    <td>{showDate(value)}</td>
                    <td>
                      <Link to={`/leases/${source.id}`} className={`ov-source${source.id === main.id ? '' : ' is-amended'}`} title={source.title}>
                        {source.id === main.id ? DOC_TYPE_LABELS.main_lease : source.title}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  )
}
