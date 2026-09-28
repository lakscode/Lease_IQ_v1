import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export const LOCALES = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
] as const

export type Locale = (typeof LOCALES)[number]['code']

const STORAGE_KEY = 'leaseiq.locale'

const isLocale = (value: unknown): value is Locale => LOCALES.some((l) => l.code === value)

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // Storage blocked; fall back to the browser language.
  }
  for (const lang of navigator.languages ?? [navigator.language]) {
    const code = lang?.slice(0, 2).toLowerCase()
    if (isLocale(code)) return code
  }
  return 'en'
}

// Module-level copy so non-React code (lib/, PDF reports) formats and translates in the current language.
let currentLocale: Locale = initialLocale()

export const getLocale = () => currentLocale

/** English name of the current language, for asking Claude to reply in it. */
export const getLanguageName = (locale: Locale = currentLocale) => LOCALES.find((l) => l.code === locale)!.english

/**
 * One area's strings in every language. English is the source; the other
 * languages must have exactly the same keys. Plurals use `key_one` / `key_other`
 * (see tp); placeholders are written {name}.
 */
export type Messages<T extends Record<string, string>> = { en: T } & Record<Exclude<Locale, 'en'>, Record<keyof T, string>>

export const defineMessages = <T extends Record<string, string>>(messages: Messages<T>) => messages

export type Vars = Record<string, string | number>

const interpolate = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text

type PluralBase<T> = { [K in keyof T]: K extends `${infer B}_one` ? B : never }[keyof T]

export type Translator<T extends Record<string, string>> = {
  /** The string for key in the current language, with {placeholders} filled in. */
  t: (key: keyof T & string, vars?: Vars) => string
  /** Plural string: picks `${key}_one` or `${key}_other` for count, which is also available as {count}. */
  tp: (key: PluralBase<T> & string, count: number, vars?: Vars) => string
}

export function translator<T extends Record<string, string>>(messages: Messages<T>, locale: Locale = currentLocale): Translator<T> {
  const dict = messages[locale] as Record<string, string>
  const en = messages.en as Record<string, string>
  const lookup = (key: string) => dict[key] ?? en[key] ?? key
  const rules = new Intl.PluralRules(locale)
  return {
    t: (key, vars) => interpolate(lookup(key), vars),
    tp: (key, count, vars) => {
      const form = rules.select(count) === 'one' ? 'one' : 'other'
      return interpolate(lookup(`${key}_${form}`), { count: formatNumber(count, undefined, locale), ...vars })
    },
  }
}

/**
 * A label map whose values are looked up in the current language each time they are read,
 * so exported constants like DOC_TYPE_LABELS keep working (including Object.entries) after a language switch.
 */
export function localizedRecord<K extends string>(keys: readonly K[], label: (key: K) => string): Record<K, string> {
  const record = {} as Record<K, string>
  for (const key of keys) Object.defineProperty(record, key, { get: () => label(key), enumerable: true })
  return record
}

export const formatNumber =(n: number, options?: Intl.NumberFormatOptions, locale: Locale = currentLocale) =>
  n.toLocaleString(locale, options)

export const formatDate = (d: Date | string, options?: Intl.DateTimeFormatOptions, locale: Locale = currentLocale) =>
  new Date(d).toLocaleDateString(locale, options)

export const formatDateTime = (d: Date | string, options?: Intl.DateTimeFormatOptions, locale: Locale = currentLocale) =>
  new Date(d).toLocaleString(locale, options)

export const formatTime = (d: Date | string, options?: Intl.DateTimeFormatOptions, locale: Locale = currentLocale) =>
  new Date(d).toLocaleTimeString(locale, options)

type I18nState = { locale: Locale; setLocale: (locale: Locale) => void }

const I18nContext = createContext<I18nState>({ locale: currentLocale, setLocale: () => {} })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(currentLocale)

  const setLocale = useCallback((next: Locale) => {
    currentLocale = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not remembered across visits; still applies now.
    }
    setLocaleState(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return <I18nContext.Provider value={{ locale, setLocale }}>{children}</I18nContext.Provider>
}

export const useLocale = () => useContext(I18nContext)

/** Translator for one area's messages; re-renders when the language changes. */
export function useT<T extends Record<string, string>>(messages: Messages<T>) {
  const { locale } = useLocale()
  return useMemo(() => ({ ...translator(messages, locale), locale }), [messages, locale])
}
