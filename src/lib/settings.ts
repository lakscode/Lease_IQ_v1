import { supabase } from './supabase'

export type ClaudeModelOption = { id: string; name: string; note: string }

// Models the Edge Functions can use (they send adaptive thinking and effort,
// which these all support). Refusal fallbacks are added only for models that
// accept them; see supabase/functions/_shared/model.ts.
export const CLAUDE_MODELS: ClaudeModelOption[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', note: 'Default. Strong accuracy for lease analysis. $5 / $25 per million tokens (input / output).' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Newest Opus, lower price. $4 / $20 per million tokens.' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', note: 'Most capable and slowest. Requires 30-day data retention on your Anthropic account. $10 / $50 per million tokens.' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', note: 'Faster and cheaper, a little less thorough. $2 / $10 per million tokens.' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', note: 'Previous-generation Opus. $5 / $25 per million tokens.' },
]

/** The model saved on the Settings page, or null when none is saved (the functions use their default). */
export async function fetchClaudeModel(): Promise<string | null> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'claude_model').maybeSingle()
  if (error) throw new Error(error.message)
  return typeof data?.value === 'string' ? data.value : null
}

export async function saveClaudeModel(model: string) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'claude_model', value: model, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}
