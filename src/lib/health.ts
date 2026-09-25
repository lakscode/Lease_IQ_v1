import { supabase } from './supabase'

// Must match FUNCTION_VERSION in supabase/functions/analyze-lease/index.ts.
export const EXPECTED_FUNCTION_VERSION = '8'

export type SetupIssue = { key: string; message: string }

/** Checks that the database migrations are applied and the current Edge Function is deployed. */
export async function checkSetup(): Promise<SetupIssue[]> {
  const issues: SetupIssue[] = []

  const { error: logsError } = await supabase.from('lease_file_logs').select('id', { head: true, count: 'exact' }).limit(1)
  if (logsError) {
    console.warn('[setup] lease_file_logs check failed:', logsError.message)
    issues.push({
      key: 'logs-table',
      message:
        'Processing logs are not being saved: the lease_file_logs table is missing. Run supabase/migrations/20260923010000_lease_file_logs.sql in the Supabase SQL Editor.',
    })
  }

  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-lease`, { method: 'OPTIONS' })
    const version = res.headers.get('x-function-version')
    console.info('[setup] analyze-lease responded', { status: res.status, version })
    if (res.status === 404) {
      issues.push({ key: 'function', message: 'The analyze-lease Edge Function is not deployed.' })
    } else if (version !== EXPECTED_FUNCTION_VERSION) {
      issues.push({
        key: 'function',
        message: `The deployed analyze-lease Edge Function is out of date (deployed: ${version ? `v${version}` : 'older than v3'}, expected: v${EXPECTED_FUNCTION_VERSION}). Redeploy supabase/functions/analyze-lease/index.ts.`,
      })
    }
  } catch (err) {
    console.warn('[setup] analyze-lease check failed:', err)
    issues.push({ key: 'function', message: 'Could not reach the analyze-lease Edge Function. Make sure it is deployed.' })
  }

  return issues
}
