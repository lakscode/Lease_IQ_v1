// Semantic search over lease pages: Voyage AI embeddings stored in MongoDB
// Atlas Vector Search. Optional — when VOYAGE_API_KEY or MONGODB_URI is not
// set, vectorsEnabled() is false and callers fall back to keyword search.
//
// MongoDB has no row level security, so every read, write and delete here is
// scoped to the authenticated user's id; callers pass the id from
// supabase.auth.getUser(), never one from the request body.

import { MongoClient, type Collection } from 'npm:mongodb@6'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { config } from '../analyze-lease/config.ts'
import { compactText } from './text.ts'

const settings = config as Record<string, string | undefined>
const VOYAGE_API_KEY = Deno.env.get('VOYAGE_API_KEY') || settings.voyageApiKey || ''
// voyage-law-2 is tuned for legal text; any 1024-dimension Voyage model works without changing the index.
const VOYAGE_MODEL = Deno.env.get('VOYAGE_MODEL') || settings.voyageModel || 'voyage-law-2'
const VOYAGE_RERANK_MODEL = Deno.env.get('VOYAGE_RERANK_MODEL') || settings.voyageRerankModel || 'rerank-2.5'
const DIMENSIONS = Number(Deno.env.get('VOYAGE_DIMENSIONS') || settings.voyageDimensions || 1024)
const MONGODB_URI = Deno.env.get('MONGODB_URI') || settings.mongodbUri || ''
const MONGODB_DB = Deno.env.get('MONGODB_DB') || settings.mongodbDb || 'leaseiq'

const COLLECTION = 'lease_chunks'
const INDEX_NAME = 'lease_chunks_vector'
const CHUNK_CHARS = 4000
const CHUNK_OVERLAP = 400
// Per embeddings request; Voyage allows up to 1,000 inputs and 120K tokens for voyage-law-2.
const BATCH_INPUTS = 64
const BATCH_CHARS = 240_000

export const vectorsEnabled = () =>
  !!VOYAGE_API_KEY && VOYAGE_API_KEY !== 'pa-...' && !!MONGODB_URI && MONGODB_URI !== 'mongodb+srv://...'

type Chunk = {
  user_id: string
  file_id: string
  lease_id: string
  page_number: number
  chunk: number
  text: string
  embedding: number[]
  created_at: Date
}

export type SemanticHit = { lease_id: string; page_number: number; text: string; score: number }

let client: MongoClient | null = null
let indexChecked = false

async function chunks(): Promise<Collection<Chunk>> {
  client ??= new MongoClient(MONGODB_URI, { appName: 'leaseiq-edge' })
  await client.connect()
  return client.db(MONGODB_DB).collection<Chunk>(COLLECTION)
}

/** Creates the Atlas Vector Search index on first use (building it takes about a minute). */
async function ensureIndex(collection: Collection<Chunk>) {
  if (indexChecked) return
  const existing = await collection.listSearchIndexes(INDEX_NAME).toArray()
  if (!existing.length) {
    await collection.createSearchIndex({
      name: INDEX_NAME,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: DIMENSIONS, similarity: 'cosine' },
          { type: 'filter', path: 'user_id' },
          { type: 'filter', path: 'lease_id' },
          { type: 'filter', path: 'file_id' },
        ],
      },
    })
    await collection.createIndex({ user_id: 1, file_id: 1 })
  }
  indexChecked = true
}

async function voyage<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.voyageai.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Voyage AI ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

/** Embeds texts in batches; returns vectors in input order and the tokens used. */
export async function embed(texts: string[], inputType: 'document' | 'query') {
  const vectors: number[][] = []
  let tokens = 0
  for (let start = 0; start < texts.length; ) {
    let end = start
    let chars = 0
    while (end < texts.length && end - start < BATCH_INPUTS && (end === start || chars + texts[end].length <= BATCH_CHARS)) {
      chars += texts[end].length
      end++
    }
    const res = await voyage<{ data: Array<{ embedding: number[]; index: number }>; usage: { total_tokens: number } }>('embeddings', {
      input: texts.slice(start, end),
      model: VOYAGE_MODEL,
      input_type: inputType,
      output_dimension: DIMENSIONS,
    })
    for (const d of res.data.sort((a, b) => a.index - b.index)) vectors.push(d.embedding)
    tokens += res.usage?.total_tokens ?? 0
    start = end
  }
  return { vectors, tokens }
}

/** Splits page text into overlapping chunks small enough to embed precisely. */
function splitText(text: string) {
  if (text.length <= CHUNK_CHARS) return [text]
  const parts: string[] = []
  for (let start = 0; start < text.length; start += CHUNK_CHARS - CHUNK_OVERLAP) {
    parts.push(text.slice(start, start + CHUNK_CHARS))
    if (start + CHUNK_CHARS >= text.length) break
  }
  return parts
}

/** (Re)builds the vectors of one file's pages, each tagged with the lease document it belongs to. */
export async function indexFile(supabase: SupabaseClient, userId: string, fileId: string) {
  const [{ data: leases, error: leasesError }, { data: pages, error: pagesError }] = await Promise.all([
    supabase.from('leases').select('id, page_start, page_end').eq('file_id', fileId),
    supabase.from('lease_file_pages').select('page_number, text').eq('file_id', fileId).order('page_number'),
  ])
  if (leasesError) throw new Error(`Loading documents failed: ${leasesError.message}`)
  if (pagesError) throw new Error(`Loading page text failed: ${pagesError.message}`)

  const pending: Array<Omit<Chunk, 'embedding' | 'created_at'>> = []
  for (const page of pages ?? []) {
    const lease = leases?.find((l) => page.page_number >= l.page_start && page.page_number <= l.page_end)
    const text = compactText(page.text ?? '')
    if (!lease || !text) continue
    splitText(text).forEach((part, chunk) =>
      pending.push({ user_id: userId, file_id: fileId, lease_id: lease.id, page_number: page.page_number, chunk, text: part }),
    )
  }

  const collection = await chunks()
  await ensureIndex(collection)
  const { vectors, tokens } = pending.length ? await embed(pending.map((c) => c.text), 'document') : { vectors: [], tokens: 0 }
  await collection.deleteMany({ user_id: userId, file_id: fileId })
  if (pending.length) {
    const now = new Date()
    await collection.insertMany(pending.map((c, i) => ({ ...c, embedding: vectors[i], created_at: now })))
  }
  return { chunks: pending.length, tokens, model: VOYAGE_MODEL }
}

export async function removeFile(userId: string, fileId: string) {
  const collection = await chunks()
  const { deletedCount } = await collection.deleteMany({ user_id: userId, file_id: fileId })
  return deletedCount
}

/** The user's page chunks closest in meaning to the query, reranked by Voyage. */
export async function semanticSearch(userId: string, query: string, leaseId: string | null, limit = 8): Promise<SemanticHit[]> {
  const collection = await chunks()
  const { vectors } = await embed([query], 'query')
  const candidates = await collection
    .aggregate<SemanticHit & { chunk: number }>([
      {
        $vectorSearch: {
          index: INDEX_NAME,
          path: 'embedding',
          queryVector: vectors[0],
          numCandidates: 200,
          limit: limit * 3,
          filter: leaseId ? { user_id: userId, lease_id: leaseId } : { user_id: userId },
        },
      },
      { $project: { _id: 0, lease_id: 1, page_number: 1, chunk: 1, text: 1, score: { $meta: 'vectorSearchScore' } } },
    ])
    .toArray()
  if (candidates.length <= 1) return candidates.slice(0, limit)

  const reranked = await voyage<{ data: Array<{ index: number; relevance_score: number }> }>('rerank', {
    query,
    documents: candidates.map((c) => c.text),
    model: VOYAGE_RERANK_MODEL,
    top_k: limit,
  })
  return reranked.data.map((r) => ({ ...candidates[r.index], score: r.relevance_score }))
}
