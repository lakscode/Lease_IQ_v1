// User management for the super admin Settings page (Users tab). Needs the
// service role (Supabase Auth admin API), so only super admins may call it.
//
// POST { op: 'list' }                                   -> { users: [{ id, email, role, created_at, last_sign_in_at, confirmed }] }
// POST { op: 'create', email, password, role }          -> { user }
// POST { op: 'update', id, email?, password?, role? }   -> { user }
// POST { op: 'delete', id }                             -> { deleted: true }
//
// Deleting a user removes their account and, through the foreign keys on
// auth.users, all their rows in Postgres; their PDFs in storage and their
// documents in MongoDB (database backend and search index) are removed here.
// Super admins cannot delete or demote themselves, so one always remains.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { isSuperAdmin } from '../_shared/db/index.ts'
import { MONGO_TABLES } from '../_shared/db/mongo.ts'
import { mongoConfigured, mongoDatabase } from '../_shared/mongoClient.ts'

const FUNCTION_VERSION = '1'
const BUCKET = 'lease-files'
const ROLES = ['user', 'superadmin']
const MIN_PASSWORD = 6

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

class BadRequest extends Error {}

const validEmail = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (userError || !userData.user) return json({ error: 'Not authenticated' }, 401)
  const callerId = userData.user.id
  if (!(await isSuperAdmin(supabase, callerId))) return json({ error: 'Only super admins can manage users' }, 403)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not available to the Edge Function' }, 500)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } })

  const body = await req.json().catch(() => ({}))
  try {
    if (body.op === 'list') return json({ users: await listUsers(admin) })
    if (body.op === 'create') return json({ user: await createUser(admin, body) })
    if (body.op === 'update') return json({ user: await updateUser(admin, callerId, body) })
    if (body.op === 'delete') {
      await deleteUser(admin, callerId, body.id)
      return json({ deleted: true })
    }
    return json({ error: 'Unknown op' }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ v: FUNCTION_VERSION, step: body.op, error: message }))
    return json({ error: message }, err instanceof BadRequest ? 400 : 500)
  }
})

type Row = { id: string; email: string | null; role: string; created_at: string; last_sign_in_at: string | null; confirmed: boolean }

async function listUsers(admin: SupabaseClient): Promise<Row[]> {
  const { data: roles, error } = await admin.from('users').select('id, role')
  if (error) throw new Error(`Reading users failed: ${error.message}`)
  const roleOf = new Map((roles ?? []).map((r) => [r.id, r.role as string]))

  const rows: Row[] = []
  for (let page = 1; ; page++) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (listError) throw new Error(listError.message)
    for (const u of data.users) {
      rows.push({
        id: u.id,
        email: u.email ?? null,
        role: roleOf.get(u.id) ?? 'user',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        confirmed: !!(u.email_confirmed_at ?? u.confirmed_at),
      })
    }
    if (data.users.length < 1000) break
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

async function oneUser(admin: SupabaseClient, id: string): Promise<Row> {
  const { data, error } = await admin.auth.admin.getUserById(id)
  if (error || !data.user) throw new BadRequest(error?.message ?? 'User not found')
  const { data: row } = await admin.from('users').select('role').eq('id', id).maybeSingle()
  const u = data.user
  return {
    id: u.id,
    email: u.email ?? null,
    role: row?.role ?? 'user',
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    confirmed: !!(u.email_confirmed_at ?? u.confirmed_at),
  }
}

async function setRole(admin: SupabaseClient, id: string, email: string | null, role: string) {
  // The auth trigger normally creates the row; upsert covers accounts that predate it.
  const { error } = await admin.from('users').upsert({ id, email, role })
  if (error) throw new Error(`Saving the role failed: ${error.message}`)
}

// deno-lint-ignore no-explicit-any
async function createUser(admin: SupabaseClient, body: any) {
  if (!validEmail(body.email)) throw new BadRequest('Enter a valid email address.')
  if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD) {
    throw new BadRequest(`The password must be at least ${MIN_PASSWORD} characters.`)
  }
  const role = ROLES.includes(body.role) ? body.role : 'user'
  const email = body.email.trim().toLowerCase()
  // Created by an admin, so the address is treated as confirmed and the user can log in at once.
  const { data, error } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true })
  if (error) {
    if (error.code === 'email_exists' || /already/i.test(error.message)) throw new BadRequest('An account with this email already exists.')
    throw new BadRequest(error.message)
  }
  await setRole(admin, data.user.id, email, role)
  return oneUser(admin, data.user.id)
}

// deno-lint-ignore no-explicit-any
async function updateUser(admin: SupabaseClient, callerId: string, body: any) {
  if (typeof body.id !== 'string') throw new BadRequest('id is required')
  const current = await oneUser(admin, body.id)

  const changes: { email?: string; email_confirm?: boolean; password?: string } = {}
  if (body.email !== undefined && body.email !== current.email) {
    if (!validEmail(body.email)) throw new BadRequest('Enter a valid email address.')
    changes.email = body.email.trim().toLowerCase()
    changes.email_confirm = true
  }
  if (body.password) {
    if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD) {
      throw new BadRequest(`The password must be at least ${MIN_PASSWORD} characters.`)
    }
    changes.password = body.password
  }
  if (Object.keys(changes).length) {
    const { error } = await admin.auth.admin.updateUserById(body.id, changes)
    if (error) {
      if (error.code === 'email_exists' || /already/i.test(error.message)) throw new BadRequest('An account with this email already exists.')
      throw new BadRequest(error.message)
    }
  }
  if (body.role !== undefined && body.role !== current.role) {
    if (!ROLES.includes(body.role)) throw new BadRequest('Unknown role')
    if (body.id === callerId) throw new BadRequest('You cannot change your own role.')
    await setRole(admin, body.id, changes.email ?? current.email, body.role)
  } else if (changes.email) {
    // The auth trigger keeps public.users.email in step; set it too in case the trigger is missing.
    await admin.from('users').update({ email: changes.email }).eq('id', body.id)
  }
  return oneUser(admin, body.id)
}

async function deleteUser(admin: SupabaseClient, callerId: string, id: unknown) {
  if (typeof id !== 'string') throw new BadRequest('id is required')
  if (id === callerId) throw new BadRequest('You cannot delete your own account.')
  await oneUser(admin, id)

  // PDFs live under "<user id>/<file id>/..." in storage; foreign keys do not reach them.
  const { data: folders } = await admin.storage.from(BUCKET).list(id, { limit: 1000 })
  const paths: string[] = []
  for (const entry of folders ?? []) {
    if (entry.id) {
      paths.push(`${id}/${entry.name}`)
      continue
    }
    const { data: files } = await admin.storage.from(BUCKET).list(`${id}/${entry.name}`, { limit: 1000 })
    for (const f of files ?? []) paths.push(`${id}/${entry.name}/${f.name}`)
  }
  for (let i = 0; i < paths.length; i += 100) await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100))

  // MongoDB has no foreign keys to auth.users: remove the user's documents and search vectors.
  if (mongoConfigured()) {
    const mdb = await mongoDatabase()
    for (const name of [...MONGO_TABLES, 'lease_chunks']) await mdb.collection(name).deleteMany({ user_id: id })
  }

  // Cascades to public.users and every Postgres table that references the user.
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) throw new Error(error.message)
  console.log(JSON.stringify({ v: FUNCTION_VERSION, step: 'delete', userId: id, files: paths.length }))
}
