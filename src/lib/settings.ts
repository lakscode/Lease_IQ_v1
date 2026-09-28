import { supabase } from './supabase'
import { translator } from '../i18n'
import { libSettings } from '../i18n/messages/libSettings'

export type ClaudeModelOption = { id: string; name: string; note: string }

// Models the Edge Functions can use (they send adaptive thinking and effort,
// which these all support). Refusal fallbacks are added only for models that
// accept them; see supabase/functions/_shared/model.ts.
// The note is looked up in the current language each time it is read.
const model = (id: string, name: string, noteKey: keyof (typeof libSettings)['en']): ClaudeModelOption => ({
  id,
  name,
  get note() {
    return translator(libSettings).t(noteKey)
  },
})

export const CLAUDE_MODELS: ClaudeModelOption[] = [
  model('claude-opus-5', 'Claude Opus 5', 'note_opus5'),
  model('claude-opus-5-5', 'Claude Opus 5.5', 'note_opus55'),
  model('claude-fable-5-1', 'Claude Fable 5.1', 'note_fable51'),
  model('claude-sonnet-5', 'Claude Sonnet 5', 'note_sonnet5'),
  model('claude-opus-4-8', 'Claude Opus 4.8', 'note_opus48'),
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
