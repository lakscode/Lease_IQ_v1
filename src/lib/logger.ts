import { db } from './db'

export type LogLevel = 'info' | 'warn' | 'error'

type Entry = {
  source: 'browser'
  level: LogLevel
  step: string
  message: string
  data: Record<string, unknown> | null
  created_at: string
}

const FLUSH_DELAY_MS = 500

/** Turns anything thrown into plain JSON for logging. */
export function errorData(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') }
  return { message: String(err) }
}

/**
 * Logs every step to the browser console and, once a file id is attached,
 * to the lease_file_logs table. Entries logged before the file row exists
 * (e.g. during text extraction) are buffered and written after attach().
 */
export class FileLogger {
  private fileId: string | null
  private queue: Entry[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private dbDisabled = false

  constructor(fileId?: string) {
    this.fileId = fileId ?? null
  }

  attach(fileId: string) {
    this.fileId = fileId
    this.schedule()
  }

  info(step: string, message: string, data?: Record<string, unknown>) {
    this.log('info', step, message, data)
  }

  warn(step: string, message: string, data?: Record<string, unknown>) {
    this.log('warn', step, message, data)
  }

  error(step: string, message: string, data?: Record<string, unknown>) {
    this.log('error', step, message, data)
  }

  private log(level: LogLevel, step: string, message: string, data?: Record<string, unknown>) {
    const prefix = `[lease${this.fileId ? ` ${this.fileId.slice(0, 8)}` : ''}] ${step}: ${message}`
    const consoleFn = level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
    if (data) consoleFn(prefix, data)
    else consoleFn(prefix)

    this.queue.push({ source: 'browser', level, step, message, data: data ?? null, created_at: new Date().toISOString() })
    this.schedule()
  }

  private schedule() {
    if (!this.fileId || this.timer || this.dbDisabled) return
    this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS)
  }

  /** Writes buffered entries to the database. Logging never throws. */
  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.fileId || this.dbDisabled || !this.queue.length) return

    const batch = this.queue.splice(0)
    const fileId = this.fileId
    const { error } = await db.from('lease_file_logs').insert(batch.map((e) => ({ ...e, file_id: fileId })))
    if (error) {
      // Most likely the lease_file_logs migration has not been applied; keep console logging only.
      this.dbDisabled = true
      console.warn('[lease] Could not save processing log to the database; console logging only.', error.message)
    }
  }
}
