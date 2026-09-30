import { supabase } from './supabase'
import { getLanguageName, localizedRecord, translator } from '../i18n'
import { common } from '../i18n/messages/common'
import { libInsights } from '../i18n/messages/libInsights'
import type { CamTerms } from './cam'
import type { RentTerms } from './rentAudit'

export type InsightGroup = 'revenue' | 'risk'
export type InsightStatus = 'action' | 'watch' | 'none' | 'needs_data'

type InsightCategoryKey =
  | 'rent_escalation'
  | 'cpi_escalation'
  | 'renewal_opportunity'
  | 'market_rent_comparison'
  | 'under_billing'
  | 'missing_cam_recovery'
  | 'expired_concessions'
  | 'security_deposit_changes'
  | 'additional_rent'
  | 'percentage_rent'
  | 'renewal_notice_deadline'
  | 'termination_option'
  | 'co_tenancy'
  | 'exclusivity'
  | 'rent_free_ending'
  | 'insurance_expiry'
  | 'guarantee_expiry'
  | 'obligations'
  | 'cam_cap_violation'
  | 'amendment_not_reflected'

// Label is looked up in the current language each time it is read.
const category = (key: InsightCategoryKey, group: InsightGroup) => ({
  key: key as string,
  get label() {
    return translator(libInsights).t(`cat_${key}`)
  },
  group,
})

// Keep keys in sync with CATEGORIES in supabase/functions/lease-insights/index.ts.
export const INSIGHT_CATEGORIES: Array<{ key: string; label: string; group: InsightGroup }> = [
  category('rent_escalation', 'revenue'),
  category('cpi_escalation', 'revenue'),
  category('renewal_opportunity', 'revenue'),
  category('market_rent_comparison', 'revenue'),
  category('under_billing', 'revenue'),
  category('missing_cam_recovery', 'revenue'),
  category('expired_concessions', 'revenue'),
  category('security_deposit_changes', 'revenue'),
  category('additional_rent', 'revenue'),
  category('percentage_rent', 'revenue'),
  category('renewal_notice_deadline', 'risk'),
  category('termination_option', 'risk'),
  category('co_tenancy', 'risk'),
  category('exclusivity', 'risk'),
  category('rent_free_ending', 'risk'),
  category('insurance_expiry', 'risk'),
  category('guarantee_expiry', 'risk'),
  category('obligations', 'risk'),
  category('cam_cap_violation', 'risk'),
  category('amendment_not_reflected', 'risk'),
]

const INSIGHT_STATUSES: InsightStatus[] = ['action', 'watch', 'needs_data', 'none']

export const INSIGHT_STATUS_LABELS: Record<InsightStatus, string> = localizedRecord(INSIGHT_STATUSES, (k) =>
  translator(libInsights).t(`status_${k}`),
)

export type Insight = {
  category: string
  status: InsightStatus
  priority: 'high' | 'medium' | 'low'
  summary: string
  detail: string
  due_date: string
  amount: string
  citations: Array<{ leaseId: string; title: string; page: number }>
}

export type LeaseInsights = {
  lease_id: string
  status: 'generating' | 'ready' | 'failed'
  error: string | null
  model: string | null
  items: Insight[]
  // CAM reconciliation terms; null for insights generated before they were added.
  cam: CamTerms | null
  // Base rent schedule for the rent audit; null for insights generated before it was added.
  rent: RentTerms | null
  started_at: string
  generated_at: string | null
}

// Generation normally takes a minute or two; after this it is treated as stuck.
export const INSIGHTS_STALE_MS = 10 * 60 * 1000

/** Insights of the family a document belongs to (keyed by its main lease). */
export async function fetchInsights(familyId: string): Promise<LeaseInsights | null> {
  const { data, error } = await supabase.from('lease_insights').select('*').eq('lease_id', familyId).maybeSingle()
  if (error) throw new Error(error.message)
  return data as LeaseInsights | null
}

/** Starts generation in the lease-insights Edge Function; poll fetchInsights for the result. */
export async function requestInsights(leaseId: string) {
  const { error } = await supabase.functions.invoke('lease-insights', { body: { leaseId, language: getLanguageName() } })
  if (error) {
    if (error.name === 'FunctionsFetchError') {
      throw new Error(translator(common).t('functionUnreachable', { name: 'lease-insights' }))
    }
    const body = await error.context?.json?.().catch(() => null)
    throw new Error(body?.error ?? error.message)
  }
}

/** The group's items in category order; action first, then watch, needs data, and not in lease. */
export function groupInsights(items: Insight[], group: InsightGroup) {
  const rank: Record<InsightStatus, number> = { action: 0, watch: 1, needs_data: 2, none: 3 }
  const byKey = new Map(items.map((i) => [i.category, i]))
  return INSIGHT_CATEGORIES.filter((c) => c.group === group)
    .flatMap((c, order) => {
      const item = byKey.get(c.key)
      return item ? [{ ...item, label: c.label, order }] : []
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.order - b.order)
}
