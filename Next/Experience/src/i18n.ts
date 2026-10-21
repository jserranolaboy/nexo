import english from './locales/en.json'
export type Language = 'en' | 'es'
declare global {
  interface Window {
    nexoLocale?: string
  }
}
export function resolveLanguage(preferred: readonly string[]): Language {
  for (const candidate of preferred) {
    const code = candidate.toLowerCase().split(/[-_]/)[0]
    if (code === 'es' || code === 'en') return code
  }
  return 'en'
}
const preferences =
  typeof window === 'undefined'
    ? ['es']
    : [window.nexoLocale || '', ...(navigator.languages || [navigator.language])]
export const language = resolveLanguage(preferences)
export const locale =
  preferences.find((value) => value.toLowerCase().split(/[-_]/)[0] === language) || language
export function translate(key: string, lang: Language, ...values: (string | number)[]) {
  const format = lang === 'en' ? ((english as Record<string, string>)[key] ?? key) : key
  return format.replace(
    /\{(\d+)\}/g,
    (token, index: string) => values[Number(index)]?.toString() ?? token,
  )
}
export const t = (key: string, ...values: (string | number)[]) =>
  translate(key, language, ...values)
if (typeof document !== 'undefined') document.documentElement.lang = language
