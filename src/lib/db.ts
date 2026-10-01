// The app's database: Postgres (default) or MongoDB, as chosen on the super
// admin Settings page. Use it like the supabase client:
//
//   const { data, error } = await db.from('leases').select('*').eq('id', id).maybeSingle()
//
// On Postgres, queries go straight to Supabase (row level security applies).
// On MongoDB, the browser cannot connect itself, so each query is sent to the
// db Edge Function (supabase/functions/db), which runs it as the signed-in user.
// Auth and file storage stay on Supabase either way.

import { supabase } from './supabase'
import {
  Database,
  DATABASE_SETTING_KEY,
  DEFAULT_BACKEND,
  type DatabaseBackend,
  type DbResult,
  type Executor,
  failure,
  isBackend,
  routedExecutor,
  supabaseExecutor,
} from '../../supabase/functions/_shared/db/query'

export type { DatabaseBackend } from '../../supabase/functions/_shared/db/query'
export { DATABASE_BACKENDS, DEFAULT_BACKEND } from '../../supabase/functions/_shared/db/query'

// How long the chosen database is remembered before it is read again, so a
// switch made by a super admin reaches other open sessions.
const BACKEND_TTL_MS = 60_000

let cached: { backend: DatabaseBackend; at: number } | null = null
let pending: Promise<DatabaseBackend> | null = null

async function readBackend(): Promise<DatabaseBackend> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', DATABASE_SETTING_KEY).maybeSingle()
  if (error) console.warn('[db] reading the chosen database failed; using Postgres:', error.message)
  return isBackend(data?.value) ? data.value : DEFAULT_BACKEND
}

/** The database queries currently go to. */
export function currentBackend(): Promise<DatabaseBackend> {
  if (cached && Date.now() - cached.at < BACKEND_TTL_MS) return Promise.resolve(cached.backend)
  pending ??= readBackend()
    .then((backend) => {
      cached = { backend, at: Date.now() }
      return backend
    })
    .finally(() => (pending = null))
  return pending
}

/** Remembers a database just saved in Settings, so this session switches at once. */
export function setCurrentBackend(backend: DatabaseBackend) {
  cached = { backend, at: Date.now() }
}

/** Calls the db Edge Function; its errors come back as { error } like a query's. */
export async function invokeDbFunction<T = DbResult>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('db', { body })
  if (!error) return data as T
  let message = error.message
  if (error.name === 'FunctionsFetchError' || error.context?.status === 404) {
    message = 'The "db" Edge Function is not deployed to your Supabase project. Run npm run deploy.'
  } else {
    try {
      message = (await error.context.json()).error ?? message
    } catch {
      // Not a JSON error response; keep the generic message.
    }
  }
  throw new Error(message)
}

const postgres = supabaseExecutor(supabase)

const mongodb: Executor = {
  query: (spec) => invokeDbFunction<DbResult>({ op: 'query', spec }).catch(failure),
  rpc: (fn, args) => invokeDbFunction<DbResult>({ op: 'rpc', fn, args }).catch(failure),
}

export const db = new Database(routedExecutor(postgres, async () => ((await currentBackend()) === 'mongodb' ? mongodb : postgres)))
