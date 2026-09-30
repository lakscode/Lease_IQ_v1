import { supabase } from './supabase'
import type { ExtractedPage } from './pdf'
import { errorData, FileLogger, type LogLevel } from './logger'
import { formatNumber, localizedRecord, translator, type Vars } from '../i18n'
import { common } from '../i18n/messages/common'
import { libLeases } from '../i18n/messages/libLeases'
import { requestInsights } from './insights'

export const BUCKET = 'lease-files'
export const MAX_FILE_BYTES = 50 * 1024 * 1024

export type FileStatus = 'processing' | 'analyzing' | 'analyzed' | 'completed' | 'failed'

export type LeaseFile = {
  id: string
  file_name: string
  storage_path: string
  page_count: number
  is_scanned: boolean
  ocr_pages: number
  status: FileStatus
  error: string | null
  created_at: string
  processed_at: string | null
  /** Main lease this file was uploaded as an amendment for, if any. */
  parent_lease_id: string | null
}

export type DocType =
  | 'main_lease'
  | 'amendment'
  | 'addendum'
  | 'commencement_letter'
  | 'other'

export type Lease = {
  id: string
  file_id: string
  parent_id: string | null
  doc_type: DocType
  title: string
  page_start: number
  page_end: number
  storage_path: string | null
  effective_date: string | null
  landlord: string | null
  tenant: string | null
  premises: string | null
  summary: string | null
  abstract: Record<string, string | null>
  created_at: string
  edited_at: string | null
}

/** Lease columns that can be edited by hand; abstract fields are edited as "abstract.<key>". */
export type LeaseColumn = 'title' | 'effective_date' | 'landlord' | 'tenant' | 'premises' | 'summary'

export type EditableField = {
  // Column name, or "abstract.<key>".
  key: LeaseColumn | `abstract.${string}`
  label: string
  kind?: 'date' | 'long'
}

type LeaseMessageKey = keyof (typeof libLeases)['en']
const lt = (key: LeaseMessageKey, vars?: Vars) => translator(libLeases).t(key, vars)

/** An editable field whose label is looked up in the current language when read. */
function field(key: EditableField['key'], labelKey: LeaseMessageKey, kind?: EditableField['kind']): EditableField {
  const f: EditableField = {
    key,
    get label() {
      return lt(labelKey)
    },
  }
  if (kind) f.kind = kind
  return f
}

function section(titleKey: LeaseMessageKey, fields: EditableField[]) {
  return {
    get title() {
      return lt(titleKey)
    },
    fields,
  }
}

export const EDITABLE_SECTIONS: Array<{ title: string; fields: EditableField[] }> = [
  section('section_document', [field('title', 'field_title'), field('summary', 'field_summary', 'long')]),
  section('section_property', [
    field('premises', 'field_premises'),
    field('abstract.rentable_area', 'field_rentable_area'),
    field('abstract.permitted_use', 'field_permitted_use', 'long'),
    field('landlord', 'field_landlord'),
    field('tenant', 'field_tenant'),
  ]),
  section('section_rent', [
    field('abstract.base_rent', 'field_base_rent', 'long'),
    field('abstract.rent_escalations', 'field_escalations', 'long'),
    field('abstract.security_deposit', 'field_security_deposit'),
    field('abstract.operating_expenses', 'field_operating_expenses', 'long'),
  ]),
  section('section_dates', [
    field('effective_date', 'field_effective', 'date'),
    field('abstract.commencement_date', 'field_commencement'),
    field('abstract.expiration_date', 'field_expiration'),
    field('abstract.term', 'field_term'),
    field('abstract.renewal_notification_window_start', 'field_notification_window_start'),
    field('abstract.renewal_options_start', 'field_renewal_options_start'),
  ]),
  section('section_options', [
    field('abstract.renewal_options', 'field_renewal', 'long'),
    field('abstract.termination_options', 'field_termination', 'long'),
    field('abstract.changes_made', 'field_changes_made', 'long'),
  ]),
]

function editableLabel(key: string): string | undefined {
  if (key === 'doc_type') return lt('field_doc_type')
  for (const s of EDITABLE_SECTIONS) for (const f of s.fields) if (f.key === key) return f.label
  return undefined
}

export const fieldLabel = (field: string) =>
  editableLabel(field) ?? (field.startsWith('abstract.') ? ABSTRACT_LABELS[field.slice(9)] ?? field.slice(9) : field)

/** Current value of an editable field. Landlord, tenant and premises fall back to the abstract, as displayed. */
export function fieldValue(lease: Lease, key: EditableField['key']): string {
  const a = lease.abstract ?? {}
  if (key.startsWith('abstract.')) return a[key.slice(9)] ?? ''
  const col = key as LeaseColumn
  if (col === 'premises') return lease.premises ?? a.premises_address ?? ''
  if (col === 'landlord' || col === 'tenant') return lease[col] ?? a[col] ?? ''
  return lease[col] ?? ''
}

/**
 * Saves the changed fields of a lease. Each change is recorded in lease_edits by a
 * database trigger, with the previous value and who made it.
 */
export async function updateLeaseDetails(lease: Lease, changes: Partial<Record<EditableField['key'], string>>): Promise<Lease> {
  const patch: Record<string, unknown> = {}
  const abstract = { ...(lease.abstract ?? {}) }
  let abstractChanged = false
  for (const [key, raw] of Object.entries(changes)) {
    const value = raw?.trim() || null
    if (key.startsWith('abstract.')) {
      abstract[key.slice(9)] = value
      abstractChanged = true
    } else if (key === 'title') {
      if (!value) throw new Error(lt('err_title_empty'))
      patch.title = value
    } else {
      patch[key] = value
      // Cleared: also clear the abstract value the display would otherwise fall back to.
      const mirror = key === 'premises' ? 'premises_address' : key === 'landlord' || key === 'tenant' ? key : null
      if (!value && mirror && abstract[mirror]) {
        abstract[mirror] = null
        abstractChanged = true
      }
    }
  }
  if (abstractChanged) patch.abstract = abstract
  if (!Object.keys(patch).length) return lease
  patch.edited_at = new Date().toISOString()

  const { data, error } = await supabase.from('leases').update(patch).eq('id', lease.id).select('*').single()
  if (error) throw new Error(error.message)
  return data as Lease
}

export type LeaseEdit = {
  id: number
  lease_id: string
  edited_by: string | null
  edited_by_email: string | null
  field: string
  old_value: string | null
  new_value: string | null
  created_at: string
}

export async function fetchLeaseEdits(leaseId: string): Promise<LeaseEdit[]> {
  const { data, error } = await supabase
    .from('lease_edits')
    .select('*')
    .eq('lease_id', leaseId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw new Error(error.message)
  return data as LeaseEdit[]
}

export type ClausePrediction = { labelId: string; label: string; score: number }

export type LeaseClause = {
  id: number
  lease_id: string
  clause_index: number
  page_number: number
  text: string
  label_id: string
  label: string
  score: number
  alternatives: ClausePrediction[]
}

/** SVM scores below this are right less than half the time (ml/clause_svm.py). */
export const LOW_CONFIDENCE_SCORE = 0

export async function fetchLeaseClauses(leaseId: string): Promise<LeaseClause[]> {
  const { data, error } = await supabase
    .from('lease_clauses')
    .select('*')
    .eq('lease_id', leaseId)
    .order('clause_index')
  if (error) throw new Error(error.message)
  return data
}

export type LeaseFileLog = {
  id: number
  file_id: string
  created_at: string
  source: 'browser' | 'function'
  level: LogLevel
  step: string
  message: string
  data: Record<string, unknown> | null
}

const DOC_TYPES: DocType[] = ['main_lease', 'amendment', 'addendum', 'commencement_letter', 'other']

export const DOC_TYPE_LABELS: Record<DocType, string> = localizedRecord(DOC_TYPES, (k) => translator(common).t(`docType_${k}`))

const ABSTRACT_LABEL_KEYS: Record<string, LeaseMessageKey> = {
  landlord: 'field_landlord',
  tenant: 'field_tenant',
  premises_address: 'field_premises',
  rentable_area: 'field_rentable_area',
  commencement_date: 'field_commencement',
  term_end_date: 'abstract_term_end_date',
  expiration_date: 'field_expiration',
  term: 'field_term',
  base_rent: 'field_base_rent',
  renewal_notification_window_start: 'field_notification_window_start',
  renewal_options_start: 'field_renewal_options_start',

  rent_escalations: 'abstract_rent_escalations',
  security_deposit: 'field_security_deposit',
  renewal_options: 'abstract_renewal_options',
  termination_options: 'abstract_termination_options',
  permitted_use: 'field_permitted_use',
  operating_expenses: 'field_operating_expenses',
  changes_made: 'field_changes_made',
}

export const ABSTRACT_LABELS: Record<string, string> = localizedRecord(Object.keys(ABSTRACT_LABEL_KEYS), (k) =>
  lt(ABSTRACT_LABEL_KEYS[k]),
)

export type Stage =
  | { stage: 'extracting'; page: number; pageCount: number; ocr: boolean }
  | { stage: 'uploading' }
  | { stage: 'retrying' }
  | { stage: 'reanalyzing' }
  | { stage: 'analyzing' }
  | { stage: 'splitting'; done: number; total: number }

const POLL_INTERVAL_MS = 3000
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000

async function currentUserId() {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error(lt('err_signed_out'))
  return data.user.id
}

const folderOf = (storagePath: string) => storagePath.slice(0, storagePath.lastIndexOf('/'))
const elapsed = (start: number) => Math.round(performance.now() - start)

async function markFailed(fileId: string, err: unknown, log: FileLogger) {
  const message = err instanceof Error ? err.message : String(err)
  log.error('failed', `Processing failed: ${message}`, errorData(err))
  const { error } = await supabase.from('lease_files').update({ status: 'failed', error: message }).eq('id', fileId)
  if (error) log.error('failed', 'Could not mark file as failed', { error: error.message })
  else log.info('status', 'File status set to failed')
}

async function savePages(fileId: string, pages: ExtractedPage[], log: FileLogger) {
  const started = performance.now()
  const rows = pages.map((p) => ({ file_id: fileId, ...p }))
  log.info('save-pages', `Saving text of ${rows.length} page(s)`)
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const { error } = await supabase.from('lease_file_pages').upsert(batch)
    if (error) throw new Error(lt('err_save_pages', { detail: error.message }))
    log.info('save-pages', `Saved pages ${i + 1}-${i + batch.length}`)
  }
  log.info('save-pages', 'All page text saved', { pages: rows.length, ms: elapsed(started) })
}

/**
 * Full pipeline for a new upload: extract/OCR -> store -> AI analysis -> split.
 * With parentLeaseId, the file holds amendments (or other documents) for that main lease.
 */
export async function uploadLeaseFile(file: File, onStage: (s: Stage) => void, parentLeaseId: string | null = null): Promise<void> {
  const log = new FileLogger()
  const started = performance.now()
  log.info('upload', `Upload started: ${file.name}`, { name: file.name, size: file.size, type: file.type, parentLeaseId })

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    log.error('validate', 'Rejected: not a PDF', { type: file.type })
    throw new Error(lt('err_pdf_only'))
  }
  if (file.size > MAX_FILE_BYTES) {
    log.error('validate', 'Rejected: file larger than 50 MB', { size: file.size })
    throw new Error(lt('err_too_large'))
  }
  log.info('validate', 'File passed validation')

  const bytes = new Uint8Array(await file.arrayBuffer())
  log.info('read', 'File read into memory', { bytes: bytes.length })

  const { extractPdfText } = await import('./pdf')
  const pages = await extractPdfText(bytes, log, (p) => onStage({ stage: 'extracting', ...p }))

  onStage({ stage: 'uploading' })
  const userId = await currentUserId()
  const fileId = crypto.randomUUID()
  const storagePath = `${userId}/${fileId}/original.pdf`
  log.info('upload', 'Uploading original PDF to storage', { fileId, path: storagePath })

  const uploadStarted = performance.now()
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf' })
  if (uploadError) {
    log.error('upload', `Storage upload failed: ${uploadError.message}`)
    throw new Error(uploadError.message)
  }
  log.info('upload', 'Original PDF uploaded', { ms: elapsed(uploadStarted) })

  const ocrPages = pages.filter((p) => p.is_ocr).length
  const { error: insertError } = await supabase.from('lease_files').insert({
    id: fileId,
    file_name: file.name,
    storage_path: storagePath,
    page_count: pages.length,
    is_scanned: ocrPages > 0,
    ocr_pages: ocrPages,
    status: 'processing',
    parent_lease_id: parentLeaseId,
  })
  if (insertError) {
    log.error('db', `Creating file record failed: ${insertError.message}; removing uploaded PDF`)
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw new Error(insertError.message)
  }
  // From here on, log entries (including the buffered ones above) are saved with the file.
  log.attach(fileId)
  log.info('db', 'File record created', { fileId, pages: pages.length, scanned: ocrPages > 0, ocrPages })

  try {
    await savePages(fileId, pages, log)
    await analyzeAndSplit(fileId, storagePath, bytes, onStage, log)
    log.info('done', 'Upload fully processed', { totalMs: elapsed(started) })
  } catch (err) {
    await markFailed(fileId, err, log)
    throw err
  } finally {
    await log.flush()
  }
}

/**
 * Re-runs whatever did not finish for a file (text extraction, analysis and/or splitting).
 * With `reanalyze`, always re-runs the AI analysis (replacing the file's documents and
 * clauses), reusing the saved page text when it is complete.
 */
export async function retryLeaseFile(
  file: LeaseFile,
  onStage: (s: Stage) => void,
  { reanalyze = false }: { reanalyze?: boolean } = {},
): Promise<void> {
  const log = new FileLogger(file.id)
  const started = performance.now()
  log.info('retry', `${reanalyze ? 'Re-analyze' : 'Retry'} clicked for "${file.file_name}" (current status: ${file.status})`, {
    status: file.status,
    previousError: file.error,
    pageCount: file.page_count,
  })

  try {
    onStage({ stage: reanalyze ? 'reanalyzing' : 'retrying' })
    log.info('retry', 'Downloading original PDF from storage', { path: file.storage_path })
    const downloadStarted = performance.now()
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storage_path)
    if (error) throw new Error(lt('err_download_original', { detail: error.message }))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    log.info('retry', 'Original PDF downloaded', { bytes: bytes.length, ms: elapsed(downloadStarted) })

    const { count, error: countError } = await supabase
      .from('lease_file_pages')
      .select('*', { count: 'exact', head: true })
      .eq('file_id', file.id)
    if (countError) log.warn('retry', `Could not count saved pages: ${countError.message}`)
    const savedPages = count ?? 0
    const needsExtraction = savedPages < file.page_count || file.page_count === 0
    const splitOnly = file.status === 'analyzed' && !reanalyze
    const plan = needsExtraction
      ? 're-extract text, then analyze and split'
      : splitOnly
        ? 'split PDF only (analysis already finished)'
        : 're-run AI analysis, then split'
    log.info('retry', `Retry plan: ${plan}`, { savedPages, expectedPages: file.page_count, status: file.status })

    if (needsExtraction) {
      log.info('retry', `Page text incomplete (${savedPages}/${file.page_count}); extracting again`)
      const { extractPdfText } = await import('./pdf')
      const pages = await extractPdfText(bytes, log, (p) => onStage({ stage: 'extracting', ...p }))
      await savePages(file.id, pages, log)
    } else {
      log.info('retry', `Reusing saved text for all ${savedPages} page(s); skipping extraction and OCR`)
    }

    if (splitOnly && !needsExtraction) {
      await splitAndStore(file.id, file.storage_path, bytes, onStage, log)
    } else {
      await analyzeAndSplit(file.id, file.storage_path, bytes, onStage, log)
    }
    log.info('retry', 'Retry finished successfully', { totalMs: elapsed(started) })
  } catch (err) {
    log.error('retry', `Retry failed after ${Math.round(elapsed(started) / 1000)}s`, errorData(err))
    await markFailed(file.id, err, log)
    throw err
  } finally {
    await log.flush()
  }
}

async function analyzeAndSplit(
  fileId: string,
  storagePath: string,
  bytes: Uint8Array,
  onStage: (s: Stage) => void,
  log: FileLogger,
) {
  onStage({ stage: 'analyzing' })
  log.info('analyze', 'Calling analyze-lease Edge Function')
  await log.flush()

  const invokeStarted = performance.now()
  const { data, error, response } = await supabase.functions.invoke('analyze-lease', { body: { fileId } })
  const functionVersion = response?.headers.get('x-function-version') ?? 'unknown'
  if (error) {
    log.error('analyze', `Edge Function call failed (${error.name})`, {
      error: error.message,
      httpStatus: response?.status,
      functionVersion,
    })
    if (error.name === 'FunctionsFetchError') {
      throw new Error(lt('err_analyze_unreachable'))
    }
    let detail = error.message
    try {
      detail = (await error.context.json()).error ?? detail
    } catch {
      // Not a JSON error response; keep the generic message.
    }
    throw new Error(lt('err_start_analysis', { detail }))
  }
  log.info('analyze', 'Edge Function accepted the job; analysis running in background', {
    httpStatus: response?.status,
    functionVersion,
    response: data,
    ms: elapsed(invokeStarted),
  })

  // The function runs in the background; wait for it to report back.
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS
  const pollStarted = performance.now()
  let lastStatus = ''
  let polls = 0
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    polls++
    const { data: row, error: pollError } = await supabase
      .from('lease_files')
      .select('status, error')
      .eq('id', fileId)
      .single()
    if (pollError) throw new Error(lt('err_check_status', { detail: pollError.message }))
    if (row.status !== lastStatus || polls % 10 === 0) {
      log.info('poll', `Status: ${row.status} (after ${Math.round(elapsed(pollStarted) / 1000)}s)`, { status: row.status, polls })
      lastStatus = row.status
    }
    if (row.status === 'analyzed') break
    if (row.status === 'failed') throw new Error(row.error ?? lt('err_analysis_failed'))
    if (Date.now() > deadline) {
      log.error('poll', 'Gave up waiting for analysis', { waitedMs: elapsed(pollStarted), lastStatus })
      throw new Error(lt('err_analysis_timeout'))
    }
  }
  log.info('analyze', 'Analysis finished', { waitedMs: elapsed(pollStarted) })

  await splitAndStore(fileId, storagePath, bytes, onStage, log)
}

/** Writes one PDF per detected document and marks the file completed. */
async function splitAndStore(
  fileId: string,
  storagePath: string,
  bytes: Uint8Array,
  onStage: (s: Stage) => void,
  log: FileLogger,
) {
  const { data: leases, error } = await supabase
    .from('leases')
    .select('id, doc_type, title, page_start, page_end')
    .eq('file_id', fileId)
    .order('page_start')
  if (error) throw new Error(lt('err_load_documents', { detail: error.message }))
  log.info('split', `${leases.length} document(s) detected`, {
    documents: leases.map((l) => ({ type: l.doc_type, title: l.title, pages: `${l.page_start}-${l.page_end}` })),
  })

  // Clear split files from any earlier run.
  const folder = folderOf(storagePath)
  const { data: existing } = await supabase.storage.from(BUCKET).list(folder)
  const stale = (existing ?? []).filter((o) => o.name !== 'original.pdf').map((o) => `${folder}/${o.name}`)
  if (stale.length) {
    await supabase.storage.from(BUCKET).remove(stale)
    log.info('split', `Removed ${stale.length} split file(s) from an earlier run`)
  }

  const { data: fileRow } = await supabase.from('lease_files').select('page_count').eq('id', fileId).single()
  const pageCount = fileRow?.page_count ?? 0
  const wholeFile = leases.length === 1 && leases[0].page_start === 1 && leases[0].page_end >= pageCount

  if (wholeFile) {
    // Nothing to split: the document is the original upload.
    log.info('split', 'Single document covers the whole file; no split needed')
    const { error: updErr } = await supabase.from('leases').update({ storage_path: storagePath }).eq('id', leases[0].id)
    if (updErr) throw new Error(updErr.message)
  } else {
    const { splitPdf } = await import('./pdf')
    const parts = await splitPdf(bytes, leases.map((l) => ({ start: l.page_start, end: l.page_end })), log)
    for (let i = 0; i < leases.length; i++) {
      onStage({ stage: 'splitting', done: i, total: leases.length })
      const path = `${folder}/${leases[i].id}.pdf`
      const upStarted = performance.now()
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, parts[i], { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error(lt('err_upload_split', { n: i + 1, detail: upErr.message }))
      const { error: updErr } = await supabase.from('leases').update({ storage_path: path }).eq('id', leases[i].id)
      if (updErr) throw new Error(updErr.message)
      log.info('split', `Stored part ${i + 1}/${leases.length}: ${leases[i].title}`, { path, ms: elapsed(upStarted) })
    }
  }

  const { error: doneErr } = await supabase
    .from('lease_files')
    .update({ status: 'completed', error: null, processed_at: new Date().toISOString() })
    .eq('id', fileId)
  if (doneErr) throw new Error(doneErr.message)
  log.info('status', 'File status set to completed')

  await indexForSearch(fileId, log)
  await generateInsights(fileId, log)
}

/**
 * Starts insight generation (opportunities, CAM terms and the rent schedule for
 * the rent audit) for every lease family the file's documents belong to, so the
 * Details page has them without clicking Generate. Runs in the background in the
 * lease-insights Edge Function; a failure is logged but never fails the upload.
 */
async function generateInsights(fileId: string, log: FileLogger) {
  const { data: docs, error } = await supabase.from('leases').select('id, parent_id').eq('file_id', fileId)
  if (error) {
    log.warn('insights', `Could not load documents for insights: ${error.message}`)
    return
  }
  // One run per family, keyed by its main lease.
  const families = [...new Set((docs ?? []).map((d) => d.parent_id ?? d.id))]
  for (const leaseId of families) {
    try {
      await requestInsights(leaseId)
      log.info('insights', 'Insight generation started', { leaseId })
    } catch (e) {
      log.warn('insights', `Insight generation could not start: ${e instanceof Error ? e.message : String(e)}`, { leaseId })
    }
  }
}

/**
 * Adds the file's pages to the semantic search index (index-lease Edge Function).
 * Optional: a failure is logged but never fails the upload; the Lease Assistant
 * then still finds the file through keyword search.
 */
async function indexForSearch(fileId: string, log: FileLogger) {
  const started = performance.now()
  const { data, error } = await supabase.functions.invoke('index-lease', { body: { fileId } })
  if (error) log.warn('search-index', `Semantic search indexing failed: ${error.message}`)
  else if (data?.enabled === false) log.info('search-index', 'Semantic search is not configured; skipped')
  else log.info('search-index', `Indexed ${data?.chunks ?? 0} chunk(s) for semantic search`, { ...data, ms: elapsed(started) })
}

/** Indexes every completed file of the signed-in user for semantic search (files uploaded before it was set up). */
export async function buildSearchIndex(): Promise<{ enabled: boolean; files: number; chunks: number }> {
  const { data, error } = await supabase.functions.invoke('index-lease', { body: { all: true } })
  if (error) {
    if (error.name === 'FunctionsFetchError') throw new Error(translator(common).t('functionUnreachable', { name: 'index-lease' }))
    const body = await error.context?.json?.().catch(() => null)
    throw new Error(body?.error ?? error.message)
  }
  return { enabled: data?.enabled !== false, files: data?.files ?? 0, chunks: data?.chunks ?? 0 }
}

export async function deleteLeaseFile(file: LeaseFile) {
  console.info(`[lease ${file.id.slice(0, 8)}] delete: deleting ${file.file_name}`)
  // Drop its semantic search vectors first; best effort, the index is optional.
  const { error: indexError } = await supabase.functions.invoke('index-lease', { body: { fileId: file.id, remove: true } })
  if (indexError) console.warn(`[lease ${file.id.slice(0, 8)}] delete: removing search vectors failed`, indexError.message)
  const folder = folderOf(file.storage_path)
  const { data: objects } = await supabase.storage.from(BUCKET).list(folder)
  const paths = (objects ?? []).map((o) => `${folder}/${o.name}`)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
  console.info(`[lease ${file.id.slice(0, 8)}] delete: removed ${paths.length} stored PDF(s)`)
  const { error } = await supabase.from('lease_files').delete().eq('id', file.id)
  if (error) {
    console.error(`[lease ${file.id.slice(0, 8)}] delete: failed`, error.message)
    throw new Error(error.message)
  }
  console.info(`[lease ${file.id.slice(0, 8)}] delete: file record and all its documents, pages and logs deleted`)
}

export async function openStoredPdf(path: string) {
  console.info('[lease] open-pdf:', path)
  // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
  const tab = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  if (error || !data) {
    console.error('[lease] open-pdf: could not create signed URL', error?.message)
    tab?.close()
    throw new Error(error?.message ?? lt('err_open_file'))
  }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

export async function fetchPageText(fileId: string, start: number, end: number) {
  const { data, error } = await supabase
    .from('lease_file_pages')
    .select('page_number, text, is_ocr')
    .eq('file_id', fileId)
    .gte('page_number', start)
    .lte('page_number', end)
    .order('page_number')
  if (error) throw new Error(error.message)
  return data as ExtractedPage[]
}

export async function fetchFileLogs(fileId: string) {
  const { data, error } = await supabase
    .from('lease_file_logs')
    .select('*')
    .eq('file_id', fileId)
    .order('created_at')
    .order('id')
  if (error) throw new Error(error.message)
  return data as LeaseFileLog[]
}

export type AiUsage = {
  id: number
  file_id: string | null
  process: 'analysis' | 'reanalysis' | 'chat' | 'insights'
  chat_id: string | null
  model: string
  served_by: string | null
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  duration_ms: number | null
  created_at: string
}

/** Every input token of a request, including those written to or read from the prompt cache. */
export const totalInputTokens = (u: AiUsage) => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens

const PROCESSES: Array<AiUsage['process']> = ['analysis', 'reanalysis', 'chat', 'insights']

export const PROCESS_LABELS: Record<AiUsage['process'], string> = localizedRecord(PROCESSES, (k) => lt(`process_${k}`))

export function formatTokens(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const digits = n < 10_000 ? 1 : 0
    return `${formatNumber(n / 1000, { minimumFractionDigits: digits, maximumFractionDigits: digits })}k`
  }
  return `${formatNumber(n / 1_000_000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`
}

export async function fetchFileUsage(fileId: string): Promise<AiUsage[]> {
  const { data, error } = await supabase.from('ai_usage').select('*').eq('file_id', fileId).order('created_at')
  if (error) throw new Error(error.message)
  return data as AiUsage[]
}
