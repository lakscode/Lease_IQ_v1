import { supabase } from './supabase'
import type { ExtractedPage } from './pdf'
import { errorData, FileLogger, type LogLevel } from './logger'

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

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  main_lease: 'Main lease',
  amendment: 'Amendment',
  addendum: 'Addendum',
  commencement_letter: 'Commencement letter',
  other: 'Other',
}

export const ABSTRACT_LABELS: Record<string, string> = {
  landlord: 'Landlord',
  tenant: 'Tenant',
  premises_address: 'Premises',
  rentable_area: 'Rentable area',
  commencement_date: 'Commencement',
  term_end_date: "Term End Date",
  expiration_date: 'Expiration',
  term: 'Term',
  base_rent: 'Base rent',
  rent_escalations: 'Rent escalations',
  security_deposit: 'Security deposit',
  renewal_options: 'Renewal options',
  termination_options: 'Termination options',
  permitted_use: 'Permitted use',
  operating_expenses: 'Operating expenses',
  changes_made: 'Changes made',
}

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
  if (!data.user) throw new Error('You are signed out. Log in and try again.')
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
    if (error) throw new Error(`Saving page text failed: ${error.message}`)
    log.info('save-pages', `Saved pages ${i + 1}-${i + batch.length}`)
  }
  log.info('save-pages', 'All page text saved', { pages: rows.length, ms: elapsed(started) })
}

/** Full pipeline for a new upload: extract/OCR -> store -> AI analysis -> split. */
export async function uploadLeaseFile(file: File, onStage: (s: Stage) => void): Promise<void> {
  const log = new FileLogger()
  const started = performance.now()
  log.info('upload', `Upload started: ${file.name}`, { name: file.name, size: file.size, type: file.type })

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    log.error('validate', 'Rejected: not a PDF', { type: file.type })
    throw new Error('Only PDF files are supported.')
  }
  if (file.size > MAX_FILE_BYTES) {
    log.error('validate', 'Rejected: file larger than 50 MB', { size: file.size })
    throw new Error('PDF must be 50 MB or smaller.')
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
    if (error) throw new Error(`Downloading original PDF failed: ${error.message}`)
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
      throw new Error(
        'Could not reach the "analyze-lease" Edge Function. Make sure it is deployed to your Supabase project, then click Retry.',
      )
    }
    let detail = error.message
    try {
      detail = (await error.context.json()).error ?? detail
    } catch {
      // Not a JSON error response; keep the generic message.
    }
    throw new Error(`Could not start analysis: ${detail}`)
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
    if (pollError) throw new Error(`Checking analysis status failed: ${pollError.message}`)
    if (row.status !== lastStatus || polls % 10 === 0) {
      log.info('poll', `Status: ${row.status} (after ${Math.round(elapsed(pollStarted) / 1000)}s)`, { status: row.status, polls })
      lastStatus = row.status
    }
    if (row.status === 'analyzed') break
    if (row.status === 'failed') throw new Error(row.error ?? 'Analysis failed.')
    if (Date.now() > deadline) {
      log.error('poll', 'Gave up waiting for analysis', { waitedMs: elapsed(pollStarted), lastStatus })
      throw new Error('Analysis timed out. Use Retry to try again.')
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
  if (error) throw new Error(`Loading detected documents failed: ${error.message}`)
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
      if (upErr) throw new Error(`Uploading split PDF ${i + 1} failed: ${upErr.message}`)
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
}

export async function deleteLeaseFile(file: LeaseFile) {
  console.info(`[lease ${file.id.slice(0, 8)}] delete: deleting ${file.file_name}`)
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
    throw new Error(error?.message ?? 'Could not open file.')
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
