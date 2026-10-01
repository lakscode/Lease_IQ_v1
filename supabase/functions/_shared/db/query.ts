// Database-neutral query builder used by the app and the Edge Functions.
//
// It mirrors the part of the supabase-js query builder the app uses
// (select/insert/upsert/update/delete, eq/neq/gt/gte/lt/lte/in/is/not,
// order, limit, single, maybeSingle, rpc) but only records the query as a
// plain QuerySpec. An Executor then runs the spec on Postgres (through
// supabase-js) or on MongoDB (_shared/db/mongo.ts), depending on the database
// chosen on the super admin Settings page (app_settings.database).
//
// No imports: the browser bundle (src/lib/db.ts) and Deno both load this file.

export type DatabaseBackend = 'postgres' | 'mongodb'
export const DATABASE_BACKENDS: DatabaseBackend[] = ['postgres', 'mongodb']
export const DEFAULT_BACKEND: DatabaseBackend = 'postgres'
export const DATABASE_SETTING_KEY = 'database'

/**
 * Tables that always live in Postgres, whichever database is chosen:
 * app_settings holds the choice itself and users is filled by a trigger on
 * Supabase Auth's auth.users.
 */
export const POSTGRES_ONLY_TABLES = new Set(['app_settings', 'users'])

export type Row = Record<string, unknown>
export type Action = 'select' | 'insert' | 'upsert' | 'update' | 'delete'
export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'not.is'
export type Filter = { op: FilterOp; column: string; value: unknown }

export type QuerySpec = {
  table: string
  action: Action
  /** Columns to return: the select list, or the list given to .select() after a write. */
  columns?: string
  /** A write followed by .select(): return the written rows. */
  returning?: boolean
  count?: 'exact'
  head?: boolean
  values?: Row | Row[]
  onConflict?: string
  filters: Filter[]
  order: Array<{ column: string; ascending: boolean }>
  limit?: number
  single?: 'one' | 'maybe'
}

export type DbError = { message: string; code?: string; details?: string; hint?: string }
// deno-lint-ignore no-explicit-any
export type DbResult<T = any> = { data: T; error: DbError | null; count: number | null }

export type Executor = {
  query(spec: QuerySpec): Promise<DbResult>
  rpc(fn: string, args: Row): Promise<DbResult>
}

export const failure = (err: unknown): DbResult => ({
  data: null,
  error: typeof err === 'object' && err && 'message' in err ? (err as DbError) : { message: String(err) },
  count: null,
})

// Rows are untyped, like supabase-js without generated types: a list until .single() / .maybeSingle().
// deno-lint-ignore no-explicit-any
export class QueryBuilder<T = any[]> implements PromiseLike<DbResult<T>> {
  private spec: QuerySpec

  constructor(
    private executor: Executor,
    table: string,
  ) {
    this.spec = { table, action: 'select', filters: [], order: [] }
  }

  select(columns = '*', options: { count?: 'exact'; head?: boolean } = {}) {
    if (this.spec.action === 'select') {
      this.spec.columns = columns
      if (options.count) this.spec.count = options.count
      if (options.head) this.spec.head = true
    } else {
      this.spec.returning = true
      this.spec.columns = columns
    }
    return this
  }

  insert(values: Row | Row[]) {
    return this.write('insert', values)
  }

  upsert(values: Row | Row[], options: { onConflict?: string } = {}) {
    if (options.onConflict) this.spec.onConflict = options.onConflict
    return this.write('upsert', values)
  }

  update(values: Row) {
    return this.write('update', values)
  }

  delete(options: { count?: 'exact' } = {}) {
    this.spec.action = 'delete'
    if (options.count) this.spec.count = options.count
    return this
  }

  eq(column: string, value: unknown) {
    return this.filter('eq', column, value)
  }
  neq(column: string, value: unknown) {
    return this.filter('neq', column, value)
  }
  gt(column: string, value: unknown) {
    return this.filter('gt', column, value)
  }
  gte(column: string, value: unknown) {
    return this.filter('gte', column, value)
  }
  lt(column: string, value: unknown) {
    return this.filter('lt', column, value)
  }
  lte(column: string, value: unknown) {
    return this.filter('lte', column, value)
  }
  in(column: string, values: unknown[]) {
    return this.filter('in', column, values)
  }
  is(column: string, value: null | boolean) {
    return this.filter('is', column, value)
  }
  /** Only `not(column, 'is', value)` is supported. */
  not(column: string, operator: 'is', value: null | boolean) {
    if (operator !== 'is') throw new Error(`not(${column}, '${operator}') is not supported`)
    return this.filter('not.is', column, value)
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.spec.order.push({ column, ascending: options.ascending ?? true })
    return this
  }

  limit(count: number) {
    this.spec.limit = count
    return this
  }

  // deno-lint-ignore no-explicit-any
  single(): QueryBuilder<any> {
    this.spec.single = 'one'
    return this
  }

  // deno-lint-ignore no-explicit-any
  maybeSingle(): QueryBuilder<any> {
    this.spec.single = 'maybe'
    return this
  }

  then<R1 = DbResult<T>, R2 = never>(
    onfulfilled?: ((value: DbResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.executor.query(this.spec).catch(failure).then(onfulfilled, onrejected)
  }

  private write(action: Action, values: Row | Row[]) {
    this.spec.action = action
    this.spec.values = values
    return this
  }

  private filter(op: FilterOp, column: string, value: unknown) {
    this.spec.filters.push({ op, column, value })
    return this
  }
}

export class Database {
  constructor(private executor: Executor) {}

  from(table: string) {
    return new QueryBuilder(this.executor, table)
  }

  rpc(fn: string, args: Row = {}): Promise<DbResult> {
    return this.executor.rpc(fn, args).catch(failure)
  }

  /** Runs a spec built elsewhere (the db Edge Function receives them from the browser). */
  run(spec: QuerySpec): Promise<DbResult> {
    return this.executor.query({ ...spec, filters: spec.filters ?? [], order: spec.order ?? [] }).catch(failure)
  }
}

const FILTER_OPS = new Set<FilterOp>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'not.is'])
const ACTIONS = new Set<Action>(['select', 'insert', 'upsert', 'update', 'delete'])

// deno-lint-ignore no-explicit-any
type SupabaseLike = { from(table: string): any; rpc(fn: string, args?: Row): any }

/** Runs specs on Postgres by replaying them on a supabase-js client (row level security applies). */
export function supabaseExecutor(client: SupabaseLike): Executor {
  return {
    async query(spec) {
      if (!ACTIONS.has(spec.action)) throw new Error(`Unknown action ${spec.action}`)
      let q = client.from(spec.table)
      if (spec.action === 'select') q = q.select(spec.columns ?? '*', { count: spec.count, head: spec.head })
      else if (spec.action === 'insert') q = q.insert(spec.values)
      else if (spec.action === 'upsert') q = q.upsert(spec.values, spec.onConflict ? { onConflict: spec.onConflict } : {})
      else if (spec.action === 'update') q = q.update(spec.values)
      else q = q.delete(spec.count ? { count: spec.count } : {})
      for (const f of spec.filters) {
        if (!FILTER_OPS.has(f.op)) throw new Error(`Unknown filter ${f.op}`)
        q = f.op === 'not.is' ? q.not(f.column, 'is', f.value) : q[f.op](f.column, f.value)
      }
      if (spec.returning) q = q.select(spec.columns ?? '*')
      for (const o of spec.order) q = q.order(o.column, { ascending: o.ascending })
      if (spec.limit !== undefined) q = q.limit(spec.limit)
      if (spec.single === 'one') q = q.single()
      else if (spec.single === 'maybe') q = q.maybeSingle()
      const { data, error, count } = await q
      return { data: data ?? null, error: error ?? null, count: count ?? null }
    },
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args)
      return { data: data ?? null, error: error ?? null, count: null }
    },
  }
}

/** Sends tables in POSTGRES_ONLY_TABLES to Postgres and everything else to the chosen database. */
export function routedExecutor(postgres: Executor, chosen: () => Promise<Executor>): Executor {
  return {
    async query(spec) {
      return POSTGRES_ONLY_TABLES.has(spec.table) ? postgres.query(spec) : (await chosen()).query(spec)
    },
    async rpc(fn, args) {
      return (await chosen()).rpc(fn, args)
    },
  }
}

export const isBackend = (value: unknown): value is DatabaseBackend =>
  typeof value === 'string' && (DATABASE_BACKENDS as string[]).includes(value)
