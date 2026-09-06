import type { ExtensionConfig } from './types'

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)

export function isNuvioManifest(raw: unknown): boolean {
  return object(raw) && Array.isArray(raw.scrapers)
}

/** IDs belong to repositories: two forks may ship different code with the same scraper id. */
function repositoryId(manifestUrl: string): string {
  const url = new URL(manifestUrl)
  const value = url.origin + url.pathname
  let hash = 0x811c9dc5
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function httpUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value, base)
    return /^https?:$/.test(url.protocol) ? url.href : undefined
  } catch { return undefined }
}

/** Nuvio's repository envelope and standalone scraper entries share the same fields. */
export function normalizeNuvioManifest(raw: unknown, manifestUrl: string): ExtensionConfig[] | null {
  const entries = isNuvioManifest(raw) ? (raw as Row).scrapers as unknown[]
    : object(raw) && typeof raw.filename === 'string' && Array.isArray(raw.supportedTypes) ? [raw] : null
  if (!entries) return null
  const out: ExtensionConfig[] = []
  for (const entry of entries) {
    if (!object(entry) || typeof entry.id !== 'string' || !entry.id.trim() || entry.enabled === false) continue
    const code = httpUrl(entry.filename, manifestUrl)
    if (!code || !/\.(?:m?js)$/i.test(new URL(code).pathname)) continue
    const supportedTypes = Array.isArray(entry.supportedTypes)
      ? entry.supportedTypes.filter((type): type is 'movie' | 'tv' => type === 'movie' || type === 'tv')
      : ['movie', 'tv'] as Array<'movie' | 'tv'>
    if (!supportedTypes.length) continue
    const languages = Array.isArray(entry.contentLanguage)
      ? entry.contentLanguage.filter((lang): lang is string => typeof lang === 'string') : []
    out.push({
      id: `nuvio:${repositoryId(manifestUrl)}:${entry.id}`,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : entry.id,
      version: entry.version == null ? undefined : String(entry.version),
      description: typeof entry.description === 'string' ? entry.description : undefined,
      type: 'onlinestream-provider', runtime: 'nuvio', code, supportedTypes, scraperId: entry.id,
      icon: httpUrl(entry.logo, manifestUrl),
      // A multilingual provider must not be excluded for only its first declared language.
      lang: languages.length === 1 ? languages[0].toLowerCase() : undefined,
      settings: object(entry.settings) ? entry.settings : undefined,
    })
  }
  return out
}
