// The database the Edge Functions read and write: Postgres (default) or
// MongoDB, as chosen on the super admin Settings page (app_settings.database).
//
//   const db = createDb(supabase, accessToken)
//   const { data, error } = await db.from('leases').select('*').eq('id', id).maybeSingle()
//
// The choice is read once per request, on the first query, so a request that
// is already running (e.g. a background analysis) keeps using one database.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  Database,
  DATABASE_SETTING_KEY,
  DEFAULT_BACKEND,
  type DatabaseBackend,
  type Executor,
  isBackend,
  routedExecutor,
  supabaseExecutor,
} from './query.ts'
import { mongoExecutor } from './mongo.ts'
import { mongoDatabase } from '../mongoClient.ts'

export { Database } from './query.ts'

export async function resolveBackend(supabase: SupabaseClient): Promise<DatabaseBackend> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', DATABASE_SETTING_KEY).maybeSingle()
  if (error) console.warn(JSON.stringify({ step: 'database', message: `Reading app_settings failed: ${error.message}` }))
  return isBackend(data?.value) ? data.value : DEFAULT_BACKEND
}

/** Whether the user has the superadmin role in public.users (Postgres). */
export async function isSuperAdmin(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle()
  return data?.role === 'superadmin'
}

/** The MongoDB executor for the user the access token belongs to; access is limited to their documents. */
export async function mongoExecutorFor(supabase: SupabaseClient, accessToken: string): Promise<Executor> {
  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data.user) throw new Error('Not authenticated')
  const user = data.user
  let admin: Promise<boolean> | null = null
  return mongoExecutor({
    db: await mongoDatabase(),
    userId: user.id,
    email: user.email ?? null,
    isSuperAdmin: () => (admin ??= isSuperAdmin(supabase, user.id)),
  })
}

/**
 * Database for a request made with the caller's access token. `supabase` must
 * be a client acting as the caller, so row level security applies on Postgres.
 */
export function createDb(supabase: SupabaseClient, accessToken: string): Database {
  const postgres = supabaseExecutor(supabase)
  let chosen: Promise<Executor> | null = null
  const resolve = () =>
    (chosen ??= (async () => ((await resolveBackend(supabase)) === 'mongodb' ? await mongoExecutorFor(supabase, accessToken) : postgres))().catch(
      (err) => {
        chosen = null
        throw err
      },
    ))
  return new Database(routedExecutor(postgres, resolve))
}
