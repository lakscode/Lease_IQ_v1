// Picks the Claude model for a request: the one chosen on the super admin
// Settings page (app_settings.claude_model), else ANTHROPIC_MODEL / config.ts,
// else Claude Opus 5.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { config } from '../analyze-lease/config.ts'

export const DEFAULT_MODEL = Deno.env.get('ANTHROPIC_MODEL') || config.anthropicModel || 'claude-opus-5'

// Models with safety classifiers that accept server-side refusal fallbacks.
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1'])

export async function resolveModel(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'claude_model').maybeSingle()
  if (error) console.warn(JSON.stringify({ step: 'model', message: `Reading app_settings failed: ${error.message}` }))
  const chosen = data?.value
  return typeof chosen === 'string' && /^claude-[a-z0-9-]+$/.test(chosen) ? chosen : DEFAULT_MODEL
}

/** Request fields that turn on server-side refusal fallbacks, for models that support them. */
export function fallbackParams(model: string) {
  return FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}
}
