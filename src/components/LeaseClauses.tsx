import { useEffect, useState } from 'react'
import { fetchLeaseClauses, LOW_CONFIDENCE_SCORE, type LeaseClause } from '../lib/leases'
import { useT } from '../i18n'
import { details } from '../i18n/messages/details'

/** Clauses of one document, grouped by their SVM label. */
export function LeaseClauses({ leaseId }: { leaseId: string }) {
  const { t } = useT(details)
  const [clauses, setClauses] = useState<LeaseClause[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLeaseClauses(leaseId).then(setClauses, (e) => setError(e.message))
  }, [leaseId])

  if (error) return <p className="error small">{t('clausesError', { error })}</p>
  if (!clauses) return <p className="muted small">{t('loadingClauses')}</p>
  if (!clauses.length) return <p className="muted small">{t('noClauses')}</p>

  const groups = new Map<string, LeaseClause[]>()
  for (const c of clauses) groups.set(c.label, [...(groups.get(c.label) ?? []), c])
  const sorted = [...groups].sort((a, b) => a[0].localeCompare(b[0]))
  const uncertain = clauses.filter((c) => c.score < LOW_CONFIDENCE_SCORE).length

  return (
    <div className="clauses">
      <h4>
        {t('clausesHeading')} <span className="muted small">{t('clausesSummary', { found: clauses.length, uncertain })}</span>
      </h4>
      {sorted.map(([label, items]) => (
        <details key={label} className="clause-group">
          <summary>
            {label} <span className="muted small">({items.length})</span>
          </summary>
          {items.map((c) => (
            <div key={c.id} className="clause">
              <div className="muted small">
                {t('pageSingle', { page: c.page_number })}
                {c.score < LOW_CONFIDENCE_SCORE && (
                  <span className="badge badge-pending clause-uncertain" title={t('svmScore', { score: c.score })}>
                    {c.alternatives.length ? t('uncertainOr', { labels: c.alternatives.map((a) => a.label).join(', ') }) : t('uncertain')}
                  </span>
                )}
              </div>
              <p>{c.text}</p>
            </div>
          ))}
        </details>
      ))}
    </div>
  )
}
