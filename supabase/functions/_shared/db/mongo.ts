// Runs QuerySpecs (see query.ts) on MongoDB, with the same rules the Postgres
// schema in supabase/migrations enforces:
//
// - Row level security: every query is limited to the caller's documents
//   (user_id), and user_id is always set to the caller on insert. Super admins
//   also read every user's ai_usage. lease_file_pages has no user_id column in
//   Postgres; here it is stored (hidden) so its pages can be scoped the same way.
// - Column lists, defaults, not-null columns, generated ids (uuid or serial)
//   and unique constraints (as unique indexes) per table.
// - Foreign keys: on delete cascade / set null.
// - The leases_record_edits trigger (lease_edits history) and the
//   search_lease_pages / recreate_lease_clauses functions.
//
// Collections are named after the tables, in the MONGODB_DB database.

import type { Collection, Db, Document, Filter as MongoFilter, Sort } from 'npm:mongodb@6'
import type { Action, DbResult, Executor, Filter, QuerySpec, Row } from './query.ts'

const REQUIRED = Symbol('required')
const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()
const emptyObject = () => ({})
const emptyList = () => []

type Default = unknown | typeof REQUIRED | (() => unknown)

export type TableDef = {
  /** Column -> default: a value, a function, REQUIRED (not null, no default), or null. */
  columns: Record<string, Default>
  /** Primary key: the default conflict target of upsert. */
  key: string[]
  unique?: string[][]
  /** id is generated as 1, 2, 3, ... (Postgres identity columns). */
  serial?: boolean
  /** Actions callers may run (Postgres policies); default all. */
  actions?: Action[]
  /** Stored user_id that is not a column in Postgres. */
  hiddenOwner?: boolean
  indexes?: Array<Record<string, 1 | -1 | 'text'>>
}

const owner = { user_id: REQUIRED }

export const TABLES: Record<string, TableDef> = {
  lease_files: {
    columns: {
      id: uuid, ...owner, file_name: REQUIRED, storage_path: REQUIRED, page_count: 0, is_scanned: false, ocr_pages: 0,
      status: 'processing', error: null, created_at: now, processed_at: null, parent_lease_id: null,
    },
    key: ['id'],
    indexes: [{ user_id: 1, created_at: -1 }],
  },
  lease_file_pages: {
    columns: { file_id: REQUIRED, page_number: REQUIRED, text: '', is_ocr: false },
    key: ['file_id', 'page_number'],
    hiddenOwner: true,
    indexes: [{ text: 'text' }],
  },
  leases: {
    columns: {
      id: uuid, ...owner, file_id: REQUIRED, parent_id: null, doc_type: REQUIRED, title: REQUIRED, page_start: REQUIRED,
      page_end: REQUIRED, storage_path: null, effective_date: null, landlord: null, tenant: null, premises: null,
      summary: null, abstract: emptyObject, created_at: now, edited_at: null,
    },
    key: ['id'],
    indexes: [{ file_id: 1 }, { parent_id: 1 }],
  },
  lease_file_logs: {
    columns: {
      id: REQUIRED, file_id: REQUIRED, ...owner, created_at: now, source: REQUIRED, level: 'info', step: REQUIRED,
      message: REQUIRED, data: null,
    },
    key: ['id'],
    serial: true,
    actions: ['select', 'insert'],
    indexes: [{ file_id: 1, id: 1 }],
  },
  lease_clauses: {
    columns: {
      id: REQUIRED, lease_id: REQUIRED, ...owner, clause_index: REQUIRED, page_number: REQUIRED, text: REQUIRED,
      label_id: REQUIRED, label: REQUIRED, score: REQUIRED, alternatives: emptyList,
    },
    key: ['id'],
    unique: [['lease_id', 'clause_index']],
    serial: true,
  },
  lease_chats: {
    columns: { id: uuid, ...owner, lease_id: null, title: REQUIRED, messages: emptyList, created_at: now, updated_at: now },
    key: ['id'],
    indexes: [{ user_id: 1, updated_at: -1 }],
  },
  ai_usage: {
    columns: {
      id: REQUIRED, ...owner, file_id: null, file_name: null, process: REQUIRED, model: REQUIRED, served_by: null,
      stop_reason: null, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      usage: emptyObject, duration_ms: null, created_at: now, chat_id: null, chat_title: null, lease_id: null,
    },
    key: ['id'],
    serial: true,
    actions: ['select', 'insert'],
    indexes: [{ file_id: 1 }, { chat_id: 1 }],
  },
  lease_insights: {
    columns: {
      lease_id: REQUIRED, ...owner, status: 'generating', error: null, model: null, items: emptyList, started_at: now,
      generated_at: null, cam: null, rent: null,
    },
    key: ['lease_id'],
  },
  cam_reconciliations: {
    columns: {
      id: uuid, lease_id: REQUIRED, ...owner, year: REQUIRED, inputs: REQUIRED, result: REQUIRED, notes: null,
      created_at: now, updated_at: now,
    },
    key: ['id'],
    unique: [['lease_id', 'year']],
  },
  data_imports: {
    columns: {
      id: uuid, ...owner, source: REQUIRED, file_name: REQUIRED, row_count: 0, matched_count: 0, column_map: emptyObject,
      created_at: now,
    },
    key: ['id'],
  },
  system_leases: {
    columns: {
      id: uuid, import_id: REQUIRED, ...owner, source: REQUIRED, matched_lease_id: null, external_id: null, property: null,
      unit: null, tenant: REQUIRED, status: null, lease_start: null, lease_end: null, area_sqft: null,
      monthly_base_rent: null, cam_monthly: null, tax_monthly: null, insurance_monthly: null, other_monthly: null,
      security_deposit: null, next_escalation_date: null, next_escalation_rent: null, raw: emptyObject, created_at: now,
    },
    key: ['id'],
    indexes: [{ import_id: 1 }, { matched_lease_id: 1 }],
  },
  lease_edits: {
    columns: {
      id: REQUIRED, lease_id: REQUIRED, ...owner, edited_by: null, edited_by_email: null, field: REQUIRED,
      old_value: null, new_value: null, created_at: now,
    },
    key: ['id'],
    serial: true,
    // History is written only by the leases update "trigger" below.
    actions: ['select'],
    indexes: [{ lease_id: 1, created_at: -1 }],
  },
  rent_audits: {
    columns: {
      id: uuid, lease_id: REQUIRED, ...owner, start_month: REQUIRED, end_month: REQUIRED, inputs: REQUIRED,
      result: REQUIRED, notes: null, created_at: now, updated_at: now,
    },
    key: ['id'],
    unique: [['lease_id', 'start_month', 'end_month']],
  },
}

export const MONGO_TABLES = Object.keys(TABLES)

// Foreign keys pointing at each table's id: what happens to referencing rows when a row is deleted.
const REFERENCES: Record<string, Array<{ table: string; column: string; onDelete: 'cascade' | 'set null' }>> = {
  lease_files: [
    { table: 'lease_file_pages', column: 'file_id', onDelete: 'cascade' },
    { table: 'leases', column: 'file_id', onDelete: 'cascade' },
    { table: 'lease_file_logs', column: 'file_id', onDelete: 'cascade' },
    { table: 'ai_usage', column: 'file_id', onDelete: 'set null' },
  ],
  leases: [
    { table: 'lease_clauses', column: 'lease_id', onDelete: 'cascade' },
    { table: 'lease_insights', column: 'lease_id', onDelete: 'cascade' },
    { table: 'cam_reconciliations', column: 'lease_id', onDelete: 'cascade' },
    { table: 'rent_audits', column: 'lease_id', onDelete: 'cascade' },
    { table: 'lease_edits', column: 'lease_id', onDelete: 'cascade' },
    { table: 'leases', column: 'parent_id', onDelete: 'set null' },
    { table: 'lease_chats', column: 'lease_id', onDelete: 'set null' },
    { table: 'ai_usage', column: 'lease_id', onDelete: 'set null' },
    { table: 'system_leases', column: 'matched_lease_id', onDelete: 'set null' },
    { table: 'lease_files', column: 'parent_lease_id', onDelete: 'set null' },
  ],
  lease_chats: [{ table: 'ai_usage', column: 'chat_id', onDelete: 'set null' }],
  data_imports: [{ table: 'system_leases', column: 'import_id', onDelete: 'cascade' }],
}

export type MongoContext = {
  db: Db
  userId: string
  email: string | null
  isSuperAdmin: () => Promise<boolean>
}

class QueryError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

const ok = (data: unknown, count: number | null = null): DbResult => ({ data, error: null, count })

function toResult(err: unknown): DbResult {
  if (err instanceof QueryError) return { data: null, error: { message: err.message, code: err.code }, count: null }
  // deno-lint-ignore no-explicit-any
  const e = err as any
  if (e?.code === 11000) {
    const keys = Object.keys(e.keyValue ?? e.keyPattern ?? {}).join(', ')
    return { data: null, error: { message: `duplicate key value violates unique constraint (${keys})`, code: '23505' }, count: null }
  }
  return { data: null, error: { message: e?.message ?? String(err) }, count: null }
}

function tableDef(table: string): TableDef {
  const def = TABLES[table]
  if (!def) throw new QueryError(`Table "${table}" is not available in MongoDB`, '42P01')
  return def
}

const visibleColumns = (def: TableDef) => Object.keys(def.columns)
const storedColumns = (def: TableDef) => (def.hiddenOwner ? [...visibleColumns(def), 'user_id'] : visibleColumns(def))

function checkColumn(def: TableDef, table: string, column: string) {
  if (!(column in def.columns)) throw new QueryError(`column ${table}.${column} does not exist`, '42703')
}

function parseColumns(def: TableDef, table: string, columns: string | undefined) {
  const list = (columns ?? '*').split(',').map((c) => c.trim()).filter(Boolean)
  if (!list.length || list.includes('*')) return visibleColumns(def)
  for (const c of list) checkColumn(def, table, c)
  return list
}

const isPlainObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v)
const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

/** Filter values must be plain values, so a request cannot smuggle in MongoDB operators. */
function checkFilterValue(f: Filter) {
  const valid = f.op === 'in' ? Array.isArray(f.value) && f.value.every(isScalar) : isScalar(f.value)
  if (!valid) throw new QueryError(`Invalid value for filter ${f.op} on ${f.column}`, '22023')
}

function filterToMongo(f: Filter): MongoFilter<Document> {
  const c = f.column
  switch (f.op) {
    case 'eq':
      return { [c]: f.value }
    // Like SQL, <> never matches null.
    case 'neq':
      return { [c]: { $nin: [f.value, null] } }
    case 'gt':
      return { [c]: { $gt: f.value } }
    case 'gte':
      return { [c]: { $gte: f.value } }
    case 'lt':
      return { [c]: { $lt: f.value } }
    case 'lte':
      return { [c]: { $lte: f.value } }
    case 'in':
      return { [c]: { $in: f.value as unknown[] } }
    case 'is':
      return { [c]: f.value }
    case 'not.is':
      return { [c]: { $ne: f.value } }
  }
}

async function scope(ctx: MongoContext, table: string, action: Action): Promise<MongoFilter<Document>> {
  if (table === 'ai_usage' && action === 'select' && (await ctx.isSuperAdmin())) return {}
  return { user_id: ctx.userId }
}

async function buildFilter(ctx: MongoContext, spec: QuerySpec, def: TableDef): Promise<MongoFilter<Document>> {
  const parts: MongoFilter<Document>[] = [await scope(ctx, spec.table, spec.action)]
  for (const f of spec.filters ?? []) {
    checkColumn(def, spec.table, f.column)
    checkFilterValue(f)
    parts.push(filterToMongo(f))
  }
  return { $and: parts }
}

function buildSort(def: TableDef, spec: QuerySpec): Sort {
  const sort: Record<string, 1 | -1> = {}
  for (const o of spec.order ?? []) {
    checkColumn(def, spec.table, o.column)
    sort[o.column] = o.ascending ? 1 : -1
  }
  return sort
}

function project(doc: Document, columns: string[]): Row {
  const out: Row = {}
  for (const c of columns) out[c] = doc[c] ?? null
  return out
}

function rowsOf(values: QuerySpec['values']): Row[] {
  const rows = Array.isArray(values) ? values : [values]
  if (!rows.length || !rows.every(isPlainObject)) throw new QueryError('Expected an object or a list of objects to write', '22023')
  return rows as Row[]
}

function checkWritable(def: TableDef, table: string, row: Row) {
  for (const key of Object.keys(row)) checkColumn(def, table, key)
}

/** A full document: given values, then defaults; user_id is always the caller. */
function withDefaults(def: TableDef, table: string, row: Row, userId: string, skip: Set<string> = new Set()): Row {
  const doc: Row = {}
  for (const [column, fallback] of Object.entries(def.columns)) {
    if (skip.has(column)) continue
    if (column === 'user_id') continue
    if (row[column] !== undefined) doc[column] = row[column]
    else if (column === 'id' && def.serial) continue // assigned by nextIds
    else if (fallback === REQUIRED) throw new QueryError(`null value in column "${column}" of relation "${table}" violates not-null constraint`, '23502')
    else doc[column] = typeof fallback === 'function' ? (fallback as () => unknown)() : fallback
  }
  if (!skip.has('user_id')) doc.user_id = userId
  return doc
}

async function nextIds(db: Db, table: string, n: number): Promise<number[]> {
  const counters = db.collection<{ _id: string; seq: number }>('_counters')
  const res = await counters.findOneAndUpdate({ _id: table }, { $inc: { seq: n } }, { upsert: true, returnDocument: 'after' })
  const end = res?.seq ?? n
  return Array.from({ length: n }, (_, i) => end - n + 1 + i)
}

async function assignSerialIds(db: Db, table: string, def: TableDef, docs: Row[]) {
  if (!def.serial) return
  const missing = docs.filter((d) => d.id === undefined)
  if (!missing.length) return
  const ids = await nextIds(db, table, missing.length)
  missing.forEach((d, i) => (d.id = ids[i]))
}

const indexesReady = new Map<string, Promise<void>>()

/** Creates each collection's unique and lookup indexes once per worker. */
export function ensureIndexes(db: Db, table: string): Promise<void> {
  let ready = indexesReady.get(table)
  if (!ready) {
    const def = tableDef(table)
    const coll = db.collection(table)
    const key = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, 1 as const]))
    ready = Promise.all([
      ...[def.key, ...(def.unique ?? [])].map((cols) => coll.createIndex(key(cols), { unique: true })),
      coll.createIndex({ user_id: 1 }),
      ...(def.indexes ?? []).map((spec) => coll.createIndex(spec)),
    ]).then(() => undefined)
    ready.catch(() => indexesReady.delete(table))
    indexesReady.set(table, ready)
  }
  return ready
}

const collection = async (ctx: MongoContext, table: string): Promise<Collection<Document>> => {
  await ensureIndexes(ctx.db, table)
  return ctx.db.collection(table)
}

// ---------- Actions ----------

async function runSelect(ctx: MongoContext, spec: QuerySpec, def: TableDef) {
  const columns = parseColumns(def, spec.table, spec.columns)
  const coll = await collection(ctx, spec.table)
  const filter = await buildFilter(ctx, spec, def)
  const count = spec.count ? await coll.countDocuments(filter) : null
  if (spec.head) return ok(null, count)
  // MongoDB reads limit(0) as "no limit".
  if (spec.limit !== undefined && spec.limit <= 0) return ok([], count)
  let cursor = coll.find(filter, { projection: { _id: 0 } }).sort(buildSort(def, spec))
  if (spec.limit !== undefined) cursor = cursor.limit(Math.max(0, Math.floor(spec.limit)))
  const docs = await cursor.toArray()
  return ok(docs.map((d) => project(d, columns)), count)
}

async function insertDocs(ctx: MongoContext, table: string, rows: Row[]): Promise<Row[]> {
  const def = tableDef(table)
  const docs = rows.map((row) => {
    checkWritable(def, table, row)
    return withDefaults(def, table, row, ctx.userId)
  })
  await assignSerialIds(ctx.db, table, def, docs)
  const coll = await collection(ctx, table)
  // Copies, because insertMany adds _id to the documents it is given.
  await coll.insertMany(docs.map((d) => ({ ...d })))
  return docs
}

async function runInsert(ctx: MongoContext, spec: QuerySpec, def: TableDef) {
  const columns = spec.returning ? parseColumns(def, spec.table, spec.columns) : []
  const docs = await insertDocs(ctx, spec.table, rowsOf(spec.values))
  return ok(spec.returning ? docs.map((d) => project(d, columns)) : null, spec.count ? docs.length : null)
}

async function runUpsert(ctx: MongoContext, spec: QuerySpec, def: TableDef) {
  const columns = spec.returning ? parseColumns(def, spec.table, spec.columns) : []
  const conflict = spec.onConflict ? spec.onConflict.split(',').map((c) => c.trim()) : def.key
  for (const c of conflict) checkColumn(def, spec.table, c)
  const rows = rowsOf(spec.values)
  const coll = await collection(ctx, spec.table)

  const keys: Row[] = []
  const operations = []
  for (const row of rows) {
    checkWritable(def, spec.table, row)
    const { user_id: _ignored, ...given } = row
    for (const c of conflict) {
      if (given[c] === undefined || given[c] === null) throw new QueryError(`upsert on ${spec.table} needs a value for ${c}`, '23502')
    }
    const key = Object.fromEntries(conflict.map((c) => [c, given[c]]))
    keys.push(key)
    // Columns that were sent are written either way; defaults only on insert (like Postgres ON CONFLICT DO UPDATE).
    const onInsert = withDefaults(def, spec.table, given, ctx.userId, new Set([...Object.keys(given)]))
    onInsert.user_id = ctx.userId
    operations.push({ key, given, onInsert })
  }
  const needIds = operations.filter((o) => def.serial && o.given.id === undefined).map((o) => o.onInsert)
  await assignSerialIds(ctx.db, spec.table, def, needIds)

  // The caller's documents only: another user's row with the same key fails as a duplicate.
  await coll.bulkWrite(
    operations.map(({ key, given, onInsert }) => ({
      updateOne: {
        filter: { user_id: ctx.userId, ...key },
        update: { $set: given, $setOnInsert: onInsert },
        upsert: true,
      },
    })),
    { ordered: true },
  )
  if (!spec.returning) return ok(null)
  const docs = await coll.find({ user_id: ctx.userId, $or: keys }, { projection: { _id: 0 } }).toArray()
  return ok(docs.map((d) => project(d, columns)))
}

async function runUpdate(ctx: MongoContext, spec: QuerySpec, def: TableDef) {
  const columns = spec.returning ? parseColumns(def, spec.table, spec.columns) : []
  const [patch] = rowsOf(spec.values)
  checkWritable(def, spec.table, patch)
  // Ownership cannot be changed.
  const { user_id: _ignored, ...changes } = patch
  const coll = await collection(ctx, spec.table)
  const before = await coll.find(await buildFilter(ctx, spec, def)).toArray()
  const ids = before.map((d) => d._id)
  if (ids.length && Object.keys(changes).length) {
    await coll.updateMany({ _id: { $in: ids } }, { $set: changes })
    if (spec.table === 'leases') await recordLeaseEdits(ctx, before, changes)
  }
  let data: Row[] | null = null
  if (spec.returning) {
    const after = await coll.find({ _id: { $in: ids } }).sort(buildSort(def, spec)).toArray()
    data = after.map((d) => project(d, columns))
  }
  return ok(data, spec.count ? ids.length : null)
}

async function runDelete(ctx: MongoContext, spec: QuerySpec, def: TableDef) {
  const columns = spec.returning ? parseColumns(def, spec.table, spec.columns) : []
  const coll = await collection(ctx, spec.table)
  const before = await coll.find(await buildFilter(ctx, spec, def)).toArray()
  if (before.length) {
    await coll.deleteMany({ _id: { $in: before.map((d) => d._id) } })
    await cascade(ctx, spec.table, before)
  }
  return ok(spec.returning ? before.map((d) => project(d, columns)) : null, spec.count ? before.length : null)
}

/** Applies on delete cascade / set null to the rows that referenced the deleted ones. */
async function cascade(ctx: MongoContext, table: string, deleted: Document[]) {
  const ids = deleted.map((d) => d.id).filter((id) => id !== undefined && id !== null)
  if (!ids.length) return
  for (const ref of REFERENCES[table] ?? []) {
    const coll = ctx.db.collection(ref.table)
    if (ref.onDelete === 'set null') {
      await coll.updateMany({ [ref.column]: { $in: ids } }, { $set: { [ref.column]: null } })
    } else {
      const children = await coll.find({ [ref.column]: { $in: ids } }).toArray()
      if (!children.length) continue
      await coll.deleteMany({ _id: { $in: children.map((c) => c._id) } })
      await cascade(ctx, ref.table, children)
    }
  }
}

// ---------- leases_record_edits trigger ----------

const TRACKED_FIELDS = ['title', 'doc_type', 'effective_date', 'landlord', 'tenant', 'premises', 'summary']

/** Text of a value the way Postgres's ->> returns it. */
const asText = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v))
const nullIfEmpty = (v: string | null) => (v === '' ? null : v)

async function recordLeaseEdits(ctx: MongoContext, before: Document[], changes: Row) {
  const edits: Row[] = []
  for (const old of before) {
    const next = { ...old, ...changes }
    const base = { lease_id: old.id, user_id: old.user_id, edited_by: ctx.userId, edited_by_email: ctx.email }
    for (const field of TRACKED_FIELDS) {
      const [o, n] = [asText(old[field]), asText(next[field])]
      if (o !== n) edits.push({ ...base, field, old_value: o, new_value: n })
    }
    if ('abstract' in changes) {
      const [oa, na] = [(old.abstract ?? {}) as Row, (next.abstract ?? {}) as Row]
      for (const k of new Set([...Object.keys(oa), ...Object.keys(na)])) {
        const [o, n] = [nullIfEmpty(asText(oa[k])), nullIfEmpty(asText(na[k]))]
        if (o !== n) edits.push({ ...base, field: `abstract.${k}`, old_value: o, new_value: n })
      }
    }
  }
  if (!edits.length) return
  const def = TABLES.lease_edits
  const docs = edits.map((e) => ({ ...withDefaults(def, 'lease_edits', e, ctx.userId, new Set(['user_id'])), user_id: e.user_id }))
  await assignSerialIds(ctx.db, 'lease_edits', def, docs)
  await (await collection(ctx, 'lease_edits')).insertMany(docs)
}

// ---------- Functions (rpc) ----------

/** Up to three passages around the query words, like ts_headline in search_lease_pages. */
function excerpt(text: string, terms: string[]) {
  const words = text.split(/\s+/).filter(Boolean)
  const stems = terms.map((t) => t.slice(0, Math.max(4, Math.min(t.length, 6))))
  const hits: number[] = []
  words.forEach((w, i) => {
    const lw = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    if (stems.some((s) => lw.startsWith(s))) hits.push(i)
  })
  if (!hits.length) return words.slice(0, 40).join(' ')
  const windows: Array<[number, number]> = []
  for (const h of hits) {
    const [start, end] = [Math.max(0, h - 12), Math.min(words.length, h + 28)]
    const last = windows[windows.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else windows.push([start, end])
    if (windows.length > 3) break
  }
  return windows.slice(0, 3).map(([s, e]) => words.slice(s, e).join(' ')).join(' … ')
}

async function searchLeasePages(ctx: MongoContext, args: Row) {
  // Quotes and leading minus signs would make MongoDB require phrases or exclude words.
  const query = String(args.search_query ?? '').replace(/"/g, ' ').replace(/(^|\s)-+/g, ' ').trim()
  const leaseFilter = typeof args.lease_filter === 'string' ? args.lease_filter : null
  const limit = Math.min(Math.max(Number(args.match_count) || 8, 1), 20)
  if (!query) return ok([])

  const leases = await collection(ctx, 'leases')
  const pagesFilter: Document = { user_id: ctx.userId, $text: { $search: query, $language: 'english' } }
  if (leaseFilter) {
    const lease = await leases.findOne({ user_id: ctx.userId, id: leaseFilter })
    if (!lease) return ok([])
    Object.assign(pagesFilter, { file_id: lease.file_id, page_number: { $gte: lease.page_start, $lte: lease.page_end } })
  }
  const pages = await (await collection(ctx, 'lease_file_pages'))
    .find(pagesFilter, { projection: { _id: 0, file_id: 1, page_number: 1, text: 1, score: { $meta: 'textScore' } } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit * 3)
    .toArray()
  if (!pages.length) return ok([])

  const docs = await leases
    .find({ user_id: ctx.userId, file_id: { $in: [...new Set(pages.map((p) => p.file_id))] }, ...(leaseFilter ? { id: leaseFilter } : {}) })
    .toArray()
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2)
  const rows: Row[] = []
  for (const page of pages) {
    for (const lease of docs) {
      if (lease.file_id !== page.file_id || page.page_number < lease.page_start || page.page_number > lease.page_end) continue
      rows.push({
        lease_id: lease.id,
        lease_title: lease.title,
        doc_type: lease.doc_type,
        page_number: page.page_number,
        rank: page.score,
        excerpt: excerpt(page.text ?? '', terms),
      })
    }
  }
  return ok(rows.slice(0, limit))
}

async function recreateLeaseClauses(ctx: MongoContext) {
  if (!(await ctx.isSuperAdmin())) throw new QueryError('Only super admins can recreate lease_clauses', '42501')
  const exists = await ctx.db.listCollections({ name: 'lease_clauses' }).hasNext()
  if (exists) await ctx.db.collection('lease_clauses').drop()
  await ctx.db.collection('_counters').deleteOne({ _id: 'lease_clauses' } as Document)
  indexesReady.delete('lease_clauses')
  await ensureIndexes(ctx.db, 'lease_clauses')
  return ok(null)
}

// ---------- Executor ----------

export function mongoExecutor(ctx: MongoContext): Executor {
  return {
    async query(spec) {
      try {
        const def = tableDef(spec.table)
        if (def.actions && !def.actions.includes(spec.action)) {
          throw new QueryError(`permission denied: ${spec.action} on ${spec.table}`, '42501')
        }
        const result =
          spec.action === 'select'
            ? await runSelect(ctx, spec, def)
            : spec.action === 'insert'
              ? await runInsert(ctx, spec, def)
              : spec.action === 'upsert'
                ? await runUpsert(ctx, spec, def)
                : spec.action === 'update'
                  ? await runUpdate(ctx, spec, def)
                  : spec.action === 'delete'
                    ? await runDelete(ctx, spec, def)
                    : null
        if (!result) throw new QueryError(`Unknown action ${spec.action}`)
        return single(result, spec)
      } catch (err) {
        return toResult(err)
      }
    },
    async rpc(fn, args) {
      try {
        if (fn === 'search_lease_pages') return await searchLeasePages(ctx, args ?? {})
        if (fn === 'recreate_lease_clauses') return await recreateLeaseClauses(ctx)
        throw new QueryError(`Function ${fn} is not available in MongoDB`, '42883')
      } catch (err) {
        return toResult(err)
      }
    },
  }
}

/** .single() / .maybeSingle(), with PostgREST's errors. */
function single(result: DbResult, spec: QuerySpec): DbResult {
  if (!spec.single || !Array.isArray(result.data)) return result
  const rows = result.data
  if (rows.length === 1) return { ...result, data: rows[0] }
  if (rows.length === 0 && spec.single === 'maybe') return { ...result, data: null }
  return {
    data: null,
    error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: `The result contains ${rows.length} rows` },
    count: null,
  }
}

// ---------- Copying Postgres data ----------

/** Writes rows read from Postgres (with their user_id) into MongoDB, replacing documents with the same key. */
export async function importRows(db: Db, table: string, rows: Row[]) {
  const def = tableDef(table)
  await ensureIndexes(db, table)
  if (!rows.length) return 0
  const columns = storedColumns(def)
  const docs = rows.map((row) => {
    const doc: Row = {}
    for (const c of columns) doc[c] = normalizeTimestamp(c, row[c] ?? null)
    return doc
  })
  await db.collection(table).bulkWrite(
    docs.map((doc) => ({
      replaceOne: { filter: Object.fromEntries(def.key.map((k) => [k, doc[k]])), replacement: doc, upsert: true },
    })),
    { ordered: false },
  )
  if (def.serial) {
    const maxId = Math.max(...docs.map((d) => Number(d.id) || 0))
    await db.collection<{ _id: string; seq: number }>('_counters').updateOne({ _id: table }, { $max: { seq: maxId } }, { upsert: true })
  }
  return docs.length
}

// Postgres returns "2026-10-01T10:00:00.123456+00:00"; stored like new rows ("...Z") so they sort together.
const TIMESTAMP_COLUMNS = new Set(['created_at', 'updated_at', 'started_at', 'generated_at', 'processed_at', 'edited_at'])
function normalizeTimestamp(column: string, value: unknown) {
  if (!TIMESTAMP_COLUMNS.has(column) || typeof value !== 'string') return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString()
}
