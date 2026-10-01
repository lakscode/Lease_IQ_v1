import { supabase } from './supabase'
import { currentBackend, type DatabaseBackend, invokeDbFunction, setCurrentBackend } from './db'
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

/** The database chosen on the Settings page (Postgres unless MongoDB was saved). */
export const fetchDatabaseBackend = (): Promise<DatabaseBackend> => currentBackend()

export async function saveDatabaseBackend(backend: DatabaseBackend) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'database', value: backend, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  setCurrentBackend(backend)
}

export type DatabaseStatus = {
  backend: DatabaseBackend
  mongodbConfigured: boolean
  connected: boolean
  error: string | null
  /** Tables stored in MongoDB when it is chosen, in the order they are copied. */
  tables: string[]
}

/** Whether the Edge Functions can reach MongoDB (db Edge Function). */
export const fetchDatabaseStatus = () => invokeDbFunction<DatabaseStatus>({ op: 'status' })

/**
 * Copies every user's rows from Postgres into MongoDB, a page at a time,
 * replacing MongoDB documents with the same key. Postgres is not changed.
 */
export async function copyPostgresToMongo(tables: string[], onProgress: (table: string, copied: number) => void) {
  let total = 0
  for (const table of tables) {
    let copiedInTable = 0
    let offset: number | null = 0
    while (offset !== null) {
      const page: { copied: number; next: number | null } = await invokeDbFunction({ op: 'copy', table, offset })
      copiedInTable += page.copied
      total += page.copied
      offset = page.next
      onProgress(table, copiedInTable)
    }
  }
  return total
}

export type UserRole = 'superadmin' | 'user'

export type AppUser = {
  id: string
  email: string | null
  role: UserRole
  created_at: string
  last_sign_in_at: string | null
  confirmed: boolean
}

/** Calls the admin-users Edge Function (super admins only); its errors are thrown with their message. */
async function adminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return data as T
  let message = error.message
  if (error.name === 'FunctionsFetchError' || error.context?.status === 404) {
    message = 'The "admin-users" Edge Function is not deployed to your Supabase project. Run npm run deploy.'
  } else {
    try {
      message = (await error.context.json()).error ?? message
    } catch {
      // Not a JSON error response; keep the generic message.
    }
  }
  throw new Error(message)
}

/** Every registered account with its role and last sign-in. */
export const listUsers = () => adminUsers<{ users: AppUser[] }>({ op: 'list' }).then((r) => r.users)

/** Creates a confirmed account that can log in at once. */
export const createUser = (email: string, password: string, role: UserRole) =>
  adminUsers<{ user: AppUser }>({ op: 'create', email, password, role }).then((r) => r.user)

/** Changes email, role and/or password (password only when given). */
export const updateUser = (id: string, changes: { email?: string; role?: UserRole; password?: string }) =>
  adminUsers<{ user: AppUser }>({ op: 'update', id, ...changes }).then((r) => r.user)

/** Deletes the account with all its files, leases and other data. */
export const deleteUser = (id: string) => adminUsers<{ deleted: boolean }>({ op: 'delete', id })
