// Answers questions about the user's leases (retrieval-augmented generation).
// Claude gets a catalogue of the user's lease documents with their abstracts,
// plus two tools: full-text search over every page (search_lease_pages SQL
// function) and reading whole pages. It searches until it can answer, then
// replies with page citations.
//
// POST { messages: [{ role: 'user' | 'assistant', content }], leaseId?, chatId?, language? }
//   -> { answer, sources: [{ leaseId, title, docType, page }], usage: { input, output } }
// Each question's token usage is saved to ai_usage (process 'chat', linked to chatId).
// language is the English name of the app's interface language (see LANGUAGES); answers are written in it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0'
// Shares the API key settings with analyze-lease (gitignored; see config.example.ts there).
import { config } from '../analyze-lease/config.ts'
import { fallbackParams, resolveModel } from '../_shared/model.ts'
import { compactText } from '../_shared/text.ts'
import { semanticSearch, vectorsEnabled } from '../_shared/vectors.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || config.anthropicApiKey
const ANTHROPIC_BASE_URL = Deno.env.get('ANTHROPIC_BASE_URL') || config.anthropicBaseUrl || undefined

const FUNCTION_VERSION = '6'
const MAX_TOOL_ROUNDS = 8
const MAX_HISTORY = 20
const MAX_MESSAGE_CHARS = 8000
const MAX_PAGES_PER_READ = 6
const MAX_SOURCES = 10

// Interface languages of the app (src/i18n/index.tsx), with the reply used when there are no documents yet.
const LANGUAGES: Record<string, string> = {
  English: 'You have no analyzed lease documents yet. Upload a lease on the Lease Abstraction page first.',
  German: 'Sie haben noch keine analysierten Mietvertragsdokumente. Laden Sie zuerst einen Mietvertrag auf der Seite Mietvertragsauszug hoch.',
  Spanish: 'Todavía no tiene documentos de arrendamiento analizados. Suba primero un contrato en la página Resumen de contratos.',
  Portuguese: 'Você ainda não tem documentos de locação analisados. Envie primeiro um contrato na página Resumo de contratos.',
  Italian: 'Non hai ancora documenti di locazione analizzati. Carica prima un contratto nella pagina Sintesi contratti.',
}

const languageInstruction = (language: string) =>
  `The user's interface language is ${language}. Write your answer in ${language}, even when the lease documents are in another language, unless the user's latest message is clearly written in a different language; then answer in that language. Keep document titles and short quotes of lease wording as written.`

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

const SYSTEM_PROMPT = `You are LeaseIQ's lease assistant. You answer questions about the user's commercial lease documents: main leases and the amendments, addenda and commencement letters that modify them.

<lease_catalogue> lists every document the user has, with its id, type, parent main lease, page range and an AI-extracted abstract. The abstracts are a helpful index but can be incomplete or out of date, so check the lease text before relying on them for anything specific.

Use search_lease_text to find relevant passages and read_pages to read full pages around a hit. Search with the words a lease would use (e.g. "renewal option notice", "holdover rent"), and try synonyms if a search finds nothing. Amendments and addenda can change the main lease, so when a term may have been modified, check the child documents too and say which document controls.

Answer from the documents only. If they don't answer the question, say so and say what you searched for. Cite the source of each fact as (Document title, p. N), using the page numbers the tools return. Keep answers concise. The chat shows plain text, so don't use Markdown headings, tables or links; use short "- " bullet lists and **bold** for key terms.`

const TOOLS = [
  {
    name: 'search_lease_text',
    description:
      'Searches every page of the user\'s lease documents by keywords and, when available, by meaning (semantic search), so a question in plain words also finds clauses that use different terms. Returns up to 8 ranked pages with the lease document, page number and matching excerpts.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'lease_id'],
      properties: {
        query: { type: 'string', description: 'Keywords or a short phrase to search for.' },
        lease_id: { type: ['string', 'null'], description: 'Limit the search to one document id from the catalogue, or null for all documents.' },
      },
    },
  },
  {
    name: 'read_pages',
    description: `Returns the full text of consecutive pages of one lease document (at most ${MAX_PAGES_PER_READ} pages per call).`,
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['lease_id', 'first_page', 'last_page'],
      properties: {
        lease_id: { type: 'string', description: 'Document id from the catalogue.' },
        first_page: { type: 'integer', description: 'First page number to read.' },
        last_page: { type: 'integer', description: 'Last page number to read (inclusive).' },
      },
    },
  },
]

type CatalogueLease = {
  id: string
  title: string
  doc_type: string
  parent_id: string | null
  file_id: string
  page_start: number
  page_end: number
  effective_date: string | null
  landlord: string | null
  tenant: string | null
  premises: string | null
  summary: string | null
  abstract: Record<string, unknown>
}

type ChatTurn = { role: 'user' | 'assistant'; content: string }

type Source = { leaseId: string; title: string; docType: string; page: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  // Acts as the calling user, so row level security applies to every query.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (userError || !userData.user) return json({ error: 'Not authenticated' }, 401)

  const body = await req.json().catch(() => ({}))
  const history = parseHistory(body.messages)
  if (!history) return json({ error: 'messages must be a non-empty list ending with a user message' }, 400)
  const focusId = typeof body.leaseId === 'string' ? body.leaseId : null
  const language = typeof body.language === 'string' && body.language in LANGUAGES ? body.language : 'English'

  // Saved chat this question belongs to (row level security: only the caller's own).
  let chat: { id: string; title: string } | null = null
  if (typeof body.chatId === 'string') {
    const { data } = await supabase.from('lease_chats').select('id, title').eq('id', body.chatId).maybeSingle()
    chat = data
  }

  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'sk-ant-...') {
    return json({ error: 'The Anthropic API key is not set. Put it in supabase/functions/analyze-lease/config.ts and redeploy.' }, 500)
  }

  const { data: leases, error: leasesError } = await supabase
    .from('leases')
    .select('id, title, doc_type, parent_id, file_id, page_start, page_end, effective_date, landlord, tenant, premises, summary, abstract')
    .order('created_at')
  if (leasesError) return json({ error: leasesError.message }, 500)
  if (!leases.length) {
    return json({ answer: LANGUAGES[language], sources: [] })
  }

  const catalogue = new Map((leases as CatalogueLease[]).map((l) => [l.id, l]))
  const focus = focusId ? catalogue.get(focusId) : undefined

  try {
    const result = await answer(supabase, userData.user.id, catalogue, history, focus, chat, language)
    return json(result)
  } catch (err) {
    console.error(JSON.stringify({ v: FUNCTION_VERSION, step: 'failed', error: err instanceof Error ? err.message : String(err) }))
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'The AI service is busy. Please try again in a moment.' }, 429)
    if (err instanceof Anthropic.APIError) return json({ error: `AI request failed (${err.status}): ${err.message}` }, 502)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function parseHistory(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m): ChatTurn => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
  while (messages.length && messages[0].role !== 'user') messages.shift()
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null
  return messages
}

function catalogueText(catalogue: Map<string, CatalogueLease>) {
  const docs = [...catalogue.values()].map((l) => ({
    id: l.id,
    title: l.title,
    type: l.doc_type,
    parent_id: l.parent_id,
    pages: `${l.page_start}-${l.page_end}`,
    effective_date: l.effective_date,
    landlord: l.landlord,
    tenant: l.tenant,
    premises: l.premises,
    summary: l.summary,
    abstract: l.abstract,
  }))
  return `<lease_catalogue>\n${JSON.stringify(docs)}\n</lease_catalogue>`
}

async function answer(
  supabase: SupabaseClient,
  userId: string,
  catalogue: Map<string, CatalogueLease>,
  history: ChatTurn[],
  focus: CatalogueLease | undefined,
  chat: { id: string; title: string } | null,
  language: string,
) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL })
  const model = await resolveModel(supabase)
  const usage = new UsageTally(model)
  try {
    const result = await runAnswerLoop(client, model, supabase, userId, catalogue, history, focus, usage, language)
    return { ...result, usage: usage.summary() }
  } finally {
    // Tokens are spent even when the loop fails part-way, so always record them.
    await usage.save(supabase, chat)
  }
}

/** Adds up the token usage of every Claude request made for one question. */
class UsageTally {
  input = 0
  output = 0
  cacheWrite = 0
  cacheRead = 0
  servedBy: string | null = null
  stopReason: string | null = null
  // deno-lint-ignore no-explicit-any
  rounds: any[] = []
  started = Date.now()

  constructor(readonly model: string) {}

  // deno-lint-ignore no-explicit-any
  add(message: any) {
    const u = message.usage ?? {}
    this.input += u.input_tokens ?? 0
    this.output += u.output_tokens ?? 0
    this.cacheWrite += u.cache_creation_input_tokens ?? 0
    this.cacheRead += u.cache_read_input_tokens ?? 0
    this.servedBy = message.model ?? this.servedBy
    this.stopReason = message.stop_reason ?? null
    this.rounds.push(u)
  }

  /** Input counts every input token, including those written to or read from the prompt cache. */
  summary() {
    return { input: this.input + this.cacheWrite + this.cacheRead, output: this.output }
  }

  async save(supabase: SupabaseClient, chat: { id: string; title: string } | null) {
    if (!this.rounds.length) return
    const { error } = await supabase.from('ai_usage').insert({
      process: 'chat',
      chat_id: chat?.id ?? null,
      chat_title: chat?.title ?? null,
      model: this.model,
      served_by: this.servedBy,
      stop_reason: this.stopReason,
      input_tokens: this.input,
      output_tokens: this.output,
      cache_creation_input_tokens: this.cacheWrite,
      cache_read_input_tokens: this.cacheRead,
      usage: { rounds: this.rounds },
      duration_ms: Date.now() - this.started,
    })
    if (error) console.warn(JSON.stringify({ v: FUNCTION_VERSION, step: 'usage', message: `Could not save token usage: ${error.message}` }))
  }
}

async function runAnswerLoop(
  client: Anthropic,
  model: string,
  supabase: SupabaseClient,
  userId: string,
  catalogue: Map<string, CatalogueLease>,
  history: ChatTurn[],
  focus: CatalogueLease | undefined,
  usage: UsageTally,
  language: string,
) {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m, i) =>
    focus && i === history.length - 1
      ? { role: m.role, content: `(I'm looking at "${focus.title}", document id ${focus.id}.)\n\n${m.content}` }
      : m,
  )

  const sources = new Map<string, Source & { read: boolean }>()
  const addSource = (lease: CatalogueLease, page: number, read: boolean) => {
    const key = `${lease.id}:${page}`
    const existing = sources.get(key)
    if (existing) existing.read ||= read
    else sources.set(key, { leaseId: lease.id, title: lease.title, docType: lease.doc_type, page, read })
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const message = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      ...fallbackParams(model),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'text', text: catalogueText(catalogue), cache_control: { type: 'ephemeral' } },
        // After the cache breakpoint so switching language keeps the cached catalogue.
        { type: 'text', text: languageInstruction(language) },
      ],
      // The last round gets no tools, so Claude has to answer with what it found.
      ...(round < MAX_TOOL_ROUNDS ? { tools: TOOLS } : {}),
      messages: withCacheBreakpoint(messages),
    // deno-lint-ignore no-explicit-any
    } as any)
    usage.add(message)

    console.log(JSON.stringify({ v: FUNCTION_VERSION, step: 'claude', round, stop: message.stop_reason, servedBy: message.model, usage: message.usage }))

    if (message.stop_reason === 'refusal') {
      return { answer: 'Sorry, I can\'t help with that request.', sources: [] }
    }

    if (message.stop_reason !== 'tool_use') {
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim()
      const truncated = message.stop_reason === 'max_tokens' ? '\n\n(The answer was cut off.)' : ''
      return { answer: (text || 'I could not find an answer in your lease documents.') + truncated, sources: rankSources(sources) }
    }

    messages.push({ role: 'assistant', content: message.content })
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    const results = await Promise.all(toolUses.map((use) => runTool(supabase, userId, catalogue, use, addSource)))
    messages.push({ role: 'user', content: results })
  }

  throw new Error('The assistant did not finish its answer.')
}

/**
 * Marks the end of the conversation so far for prompt caching: each tool round
 * resends every earlier message, and the next round then reads them from the
 * cache (0.1x input price) instead of paying for them again.
 */
function withCacheBreakpoint(messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  const last = messages[messages.length - 1]
  const blocks = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : [...last.content]
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } } as (typeof blocks)[number]
  return [...messages.slice(0, -1), { ...last, content: blocks }]
}

// Pages Claude read in full come first, then search hits in the order found.
function rankSources(sources: Map<string, Source & { read: boolean }>): Source[] {
  return [...sources.values()]
    .sort((a, b) => Number(b.read) - Number(a.read))
    .slice(0, MAX_SOURCES)
    .map(({ read: _read, ...s }) => s)
}

async function runTool(
  supabase: SupabaseClient,
  userId: string,
  catalogue: Map<string, CatalogueLease>,
  use: Anthropic.Beta.BetaToolUseBlock,
  addSource: (lease: CatalogueLease, page: number, read: boolean) => void,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const result = (content: string, isError = false): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: use.id,
    content,
    ...(isError ? { is_error: true } : {}),
  })
  // deno-lint-ignore no-explicit-any
  const input = use.input as any

  if (use.name === 'search_lease_text') {
    if (typeof input?.query !== 'string' || !input.query.trim()) return result('query is required', true)
    const leaseId = typeof input.lease_id === 'string' ? input.lease_id : null
    if (leaseId && !catalogue.has(leaseId)) return result(`Unknown lease_id ${leaseId}`, true)

    // Keyword (Postgres full-text) and semantic (Voyage AI + MongoDB Atlas) search run side by side.
    const [keyword, semantic] = await Promise.all([
      supabase.rpc('search_lease_pages', { search_query: input.query, lease_filter: leaseId, match_count: 8 }),
      vectorsEnabled()
        ? semanticSearch(userId, input.query, leaseId).catch((err) => {
            console.warn(JSON.stringify({ v: FUNCTION_VERSION, step: 'semantic-search', error: String(err) }))
            return []
          })
        : Promise.resolve([]),
    ])
    if (keyword.error && !semantic.length) return result(`Search failed: ${keyword.error.message}`, true)

    // Best semantic match first, then alternate between the two lists; one hit per page.
    type Hit = { leaseId: string; page: number; excerpt: string }
    const lists: Hit[][] = [
      semantic.map((h) => ({ leaseId: h.lease_id, page: h.page_number, excerpt: h.text.slice(0, 900) })),
      // deno-lint-ignore no-explicit-any
      ((keyword.data ?? []) as any[]).map((row) => ({ leaseId: row.lease_id, page: row.page_number, excerpt: row.excerpt ?? '' })),
    ]
    const merged: Hit[] = []
    const seen = new Set<string>()
    for (let i = 0; merged.length < 8 && i < Math.max(lists[0].length, lists[1].length); i++) {
      for (const list of lists) {
        const hit = list[i]
        if (!hit || seen.has(`${hit.leaseId}:${hit.page}`) || !catalogue.has(hit.leaseId) || merged.length >= 8) continue
        seen.add(`${hit.leaseId}:${hit.page}`)
        merged.push(hit)
      }
    }
    if (!merged.length) return result('No matching pages. Try other words or synonyms.')

    const hits = merged.map((hit) => {
      const lease = catalogue.get(hit.leaseId)!
      addSource(lease, hit.page, false)
      return `<hit lease_id="${lease.id}" document="${lease.title}" type="${lease.doc_type}" page="${hit.page}">\n${compactText(hit.excerpt)}\n</hit>`
    })
    return result(hits.join('\n'))
  }

  if (use.name === 'read_pages') {
    const lease = catalogue.get(input?.lease_id)
    if (!lease) return result(`Unknown lease_id ${input?.lease_id}`, true)
    const first = Math.max(Number(input.first_page) || lease.page_start, lease.page_start)
    const last = Math.min(Number(input.last_page) || first, lease.page_end, first + MAX_PAGES_PER_READ - 1)
    if (last < first) return result(`"${lease.title}" covers pages ${lease.page_start}-${lease.page_end}.`, true)

    const { data, error } = await supabase
      .from('lease_file_pages')
      .select('page_number, text')
      .eq('file_id', lease.file_id)
      .gte('page_number', first)
      .lte('page_number', last)
      .order('page_number')
    if (error) return result(`Reading pages failed: ${error.message}`, true)

    const pages = (data ?? []).map((p) => {
      addSource(lease, p.page_number, true)
      return `<page document="${lease.title}" number="${p.page_number}">\n${compactText(p.text)}\n</page>`
    })
    return result(pages.join('\n') || 'Those pages have no text.')
  }

  return result(`Unknown tool ${use.name}`, true)
}
