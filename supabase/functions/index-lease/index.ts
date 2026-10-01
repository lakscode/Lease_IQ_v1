// Keeps the semantic search index (Voyage AI embeddings in MongoDB Atlas, see
// _shared/vectors.ts) in step with the user's lease files.
//
// POST { fileId }                 -> (re)index one analyzed file   -> { indexed: true, chunks, tokens }
// POST { fileId, remove: true }   -> drop a file's vectors         -> { removed }
// POST { all: true }              -> index every completed file of the caller (backfill) -> { files, chunks, tokens }
// When Voyage AI or MongoDB is not configured: { enabled: false } (status 200), so callers can ignore it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createDb } from '../_shared/db/index.ts'
import { indexFile, removeFile, vectorsEnabled } from '../_shared/vectors.ts'

const FUNCTION_VERSION = '2'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  // Acts as the calling user, so row level security limits which files can be read.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  // Postgres or MongoDB, whichever is chosen in Settings.
  const db = createDb(supabase, authHeader.replace('Bearer ', ''))
  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (userError || !userData.user) return json({ error: 'Not authenticated' }, 401)
  const userId = userData.user.id

  if (!vectorsEnabled()) return json({ enabled: false })

  const body = await req.json().catch(() => ({}))
  try {
    if (body.all === true) {
      const { data: files, error } = await db.from('lease_files').select('id').eq('status', 'completed')
      if (error) return json({ error: error.message }, 500)
      let chunks = 0
      let tokens = 0
      for (const file of files ?? []) {
        const result = await indexFile(db, userId, file.id)
        chunks += result.chunks
        tokens += result.tokens
      }
      console.log(JSON.stringify({ v: FUNCTION_VERSION, step: 'backfill', files: files?.length ?? 0, chunks, tokens }))
      return json({ indexed: true, files: files?.length ?? 0, chunks, tokens })
    }

    if (typeof body.fileId !== 'string') return json({ error: 'fileId or all is required' }, 400)

    if (body.remove === true) {
      // Vectors are keyed by the caller's id, so this can only remove the caller's own.
      const removed = await removeFile(userId, body.fileId)
      return json({ removed })
    }

    const { data: file, error } = await db.from('lease_files').select('id').eq('id', body.fileId).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!file) return json({ error: 'File not found' }, 404)
    const result = await indexFile(db, userId, file.id)
    console.log(JSON.stringify({ v: FUNCTION_VERSION, step: 'indexed', fileId: file.id, ...result }))
    return json({ indexed: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ v: FUNCTION_VERSION, step: 'failed', error: message }))
    return json({ error: message }, 500)
  }
})
