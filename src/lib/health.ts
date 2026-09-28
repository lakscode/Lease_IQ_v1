import { supabase } from './supabase'
import { translator, type Vars } from '../i18n'
import { libHealth } from '../i18n/messages/libHealth'

// Must match FUNCTION_VERSION in supabase/functions/analyze-lease/index.ts.
export const EXPECTED_FUNCTION_VERSION = '11'

export type SetupIssue = { key: string; message: string }

type HealthKey = keyof (typeof libHealth)['en']

/** An issue whose message is looked up in the current language each time it is read. */
const issue = (key: string, messageKey: HealthKey, vars?: () => Vars): SetupIssue => ({
  key,
  get message() {
    return translator(libHealth).t(messageKey, vars?.())
  },
})

/** Checks that the database migrations are applied and the current Edge Function is deployed. */
export async function checkSetup(): Promise<SetupIssue[]> {
  const issues: SetupIssue[] = []

  const { error: logsError } = await supabase.from('lease_file_logs').select('id', { head: true, count: 'exact' }).limit(1)
  if (logsError) {
    console.warn('[setup] lease_file_logs check failed:', logsError.message)
    issues.push(issue('logs-table', 'logsTable', () => ({ file: 'supabase/migrations/20260923010000_lease_file_logs.sql' })))
  }

  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-lease`, { method: 'OPTIONS' })
    const version = res.headers.get('x-function-version')
    console.info('[setup] analyze-lease responded', { status: res.status, version })
    if (res.status === 404) {
      issues.push(issue('function', 'functionMissing'))
    } else if (version !== EXPECTED_FUNCTION_VERSION) {
      issues.push(
        issue('function', 'functionOutdated', () => ({
          deployed: version ? `v${version}` : translator(libHealth).t('olderThanV3'),
          expected: `v${EXPECTED_FUNCTION_VERSION}`,
          file: 'supabase/functions/analyze-lease/index.ts',
        })),
      )
    }
  } catch (err) {
    console.warn('[setup] analyze-lease check failed:', err)
    issues.push(issue('function', 'functionUnreachable'))
  }

  return issues
}
