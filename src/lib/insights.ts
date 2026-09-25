import { supabase } from './supabase'
import type { CamTerms } from './cam'

export type InsightGroup = 'revenue' | 'risk'
export type InsightStatus = 'action' | 'watch' | 'none' | 'needs_data'

// Keep keys in sync with CATEGORIES in supabase/functions/lease-insights/index.ts.
export const INSIGHT_CATEGORIES: Array<{ key: string; label: string; group: InsightGroup }> = [
  { key: 'rent_escalation', label: 'Upcoming rent escalation', group: 'revenue' },
  { key: 'cpi_escalation', label: 'CPI escalation', group: 'revenue' },
  { key: 'renewal_opportunity', label: 'Renewal opportunity', group: 'revenue' },
  { key: 'market_rent_comparison', label: 'Market-rent comparison', group: 'revenue' },
  { key: 'under_billing', label: 'Under-billing', group: 'revenue' },
  { key: 'missing_cam_recovery', label: 'Missing CAM recovery', group: 'revenue' },
  { key: 'expired_concessions', label: 'Expired concessions', group: 'revenue' },
  { key: 'security_deposit_changes', label: 'Security deposit changes', group: 'revenue' },
  { key: 'additional_rent', label: 'Additional rent', group: 'revenue' },
  { key: 'percentage_rent', label: 'Percentage rent', group: 'revenue' },
  { key: 'renewal_notice_deadline', label: 'Renewal notice deadline', group: 'risk' },
  { key: 'termination_option', label: 'Termination/break option', group: 'risk' },
  { key: 'co_tenancy', label: 'Co-tenancy trigger', group: 'risk' },
  { key: 'exclusivity', label: 'Exclusivity violation', group: 'risk' },
  { key: 'rent_free_ending', label: 'Rent-free period ending', group: 'risk' },
  { key: 'insurance_expiry', label: 'Insurance expiry', group: 'risk' },
  { key: 'guarantee_expiry', label: 'Guarantee expiry', group: 'risk' },
  { key: 'obligations', label: 'Required landlord/tenant obligations', group: 'risk' },
  { key: 'cam_cap_violation', label: 'CAM cap violation', group: 'risk' },
  { key: 'amendment_not_reflected', label: 'Lease amendment not reflected in system', group: 'risk' },
]

export const INSIGHT_STATUS_LABELS: Record<InsightStatus, string> = {
  action: 'Action',
  watch: 'Watch',
  needs_data: 'Needs data',
  none: 'Not in lease',
}

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
  const { error } = await supabase.functions.invoke('lease-insights', { body: { leaseId } })
  if (error) {
    if (error.name === 'FunctionsFetchError') {
      throw new Error('Could not reach the "lease-insights" Edge Function. Make sure it is deployed to your Supabase project.')
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
