// Database access for the browser when MongoDB is the chosen database
// (Settings -> Database). The browser cannot connect to MongoDB itself, so
// src/lib/db.ts sends each query here as a QuerySpec (_shared/db/query.ts).
//
// POST { op: 'query', spec }           -> { data, error, count }   (run on the chosen database)
// POST { op: 'rpc', fn, args }         -> { data, error, count }
// POST { op: 'status' }                -> { backend, mongodbConfigured, connected, error?, tables }
// POST { op: 'copy', table, offset }   -> { copied, next }   super admins: copy a page of Postgres rows to MongoDB
//
// Every query runs as the caller: row level security on Postgres, and on
// MongoDB only the caller's documents (see _shared/db/mongo.ts).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createDb, isSuperAdmin, resolveBackend } from '../_shared/db/index.ts'
import { importRows, MONGO_TABLES, TABLES } from '../_shared/db/mongo.ts'
import { mongoConfigured, mongoDatabase } from '../_shared/mongoClient.ts'

const FUNCTION_VERSION = '1'
const COPY_PAGE = 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-function-version',
  'x-function-version': FUNCTION_VERSION,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)
  const accessToken = authHeader.replace('Bearer ', '')

  // Acts as the calling user, so row level security applies on Postgres.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
  if (userError || !userData.user) return json({ error: 'Not authenticated' }, 401)
  const userId = userData.user.id

  const body = await req.json().catch(() => ({}))
  try {
    if (body.op === 'query') {
      if (typeof body.spec?.table !== 'string') return json({ error: 'spec is required' }, 400)
      return json(await createDb(supabase, accessToken).run(body.spec))
    }

    if (body.op === 'rpc') {
      if (typeof body.fn !== 'string') return json({ error: 'fn is required' }, 400)
      return json(await createDb(supabase, accessToken).rpc(body.fn, body.args ?? {}))
    }

    if (body.op === 'status') {
      const backend = await resolveBackend(supabase)
      let connected = false
      let error: string | null = null
      if (mongoConfigured()) {
        try {
          await (await mongoDatabase()).command({ ping: 1 })
          connected = true
        } catch (err) {
          error = message(err)
        }
      }
      return json({ backend, mongodbConfigured: mongoConfigured(), connected, error, tables: MONGO_TABLES, version: FUNCTION_VERSION })
    }

    if (body.op === 'copy') {
      if (!(await isSuperAdmin(supabase, userId))) return json({ error: 'Only super admins can copy data' }, 403)
      const table = body.table
      if (typeof table !== 'string' || !TABLES[table]) return json({ error: 'Unknown table' }, 400)
      const offset = Number.isInteger(body.offset) && body.offset >= 0 ? body.offset : 0
      return json(await copyPage(table, offset))
    }

    return json({ error: 'Unknown op' }, 400)
  } catch (err) {
    console.error(JSON.stringify({ v: FUNCTION_VERSION, step: body.op, error: message(err) }))
    return json({ error: message(err) }, 500)
  }
})

/** Copies one page of a table from Postgres (all users, read with the service role) into MongoDB. */
async function copyPage(table: string, offset: number) {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available to the Edge Function')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
  const def = TABLES[table]

  let query = admin.from(table).select('*')
  for (const key of def.key) query = query.order(key)
  const { data, error } = await query.range(offset, offset + COPY_PAGE - 1)
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`)
  const rows = data ?? []

  // Pages have no user_id in Postgres; they belong to their file's owner.
  if (def.hiddenOwner && rows.length) {
    const fileIds = [...new Set(rows.map((r) => r.file_id as string))]
    const { data: files, error: filesError } = await admin.from('lease_files').select('id, user_id').in('id', fileIds)
    if (filesError) throw new Error(`Reading lease_files failed: ${filesError.message}`)
    const owners = new Map((files ?? []).map((f) => [f.id, f.user_id]))
    for (const r of rows) r.user_id = owners.get(r.file_id) ?? null
  }

  const copied = await importRows(await mongoDatabase(), table, rows)
  console.log(JSON.stringify({ v: FUNCTION_VERSION, step: 'copy', table, offset, copied }))
  return { copied, next: rows.length === COPY_PAGE ? offset + COPY_PAGE : null }
}
