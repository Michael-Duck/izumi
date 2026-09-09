import { phttp } from '$lib/net/http'
import { MAX_THEME_BYTES, THEME_API, THEME_CATALOG_URL, parseCatalog, parseRelease, parseThemePackage, parseSharedTheme, themeUrl, type PreparedTheme, type ThemeCatalog, type ThemeRelease } from './packages'

const CACHE_KEY = 'theme-catalog-cache-v1'
const encoder = new TextEncoder()
// WebKit only shipped AbortSignal.any in 17.4 (early 2024); webkit2gtk and unpatched webviews can
// lack it, and an unconditional call would fail every theme download before any request is made.
function withTimeout(signal: AbortSignal, timeout: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  const combined = new AbortController()
  for (const source of [signal, timeout]) source.addEventListener('abort', () => { if (!combined.signal.aborted) combined.abort(source.reason) }, { once: true })
  return combined.signal
}
export async function fetchThemeText(url: string, limit = MAX_THEME_BYTES, signal?: AbortSignal): Promise<string> {
  const target = themeUrl(url)
  const timeout = AbortSignal.timeout(20_000)
  const combined = signal ? withTimeout(signal, timeout) : timeout
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const response = await phttp(target, { maxBytes: limit, timeoutMs: 20_000, signal: combined, background: true })
    if (!response.ok) throw new Error(`Theme download failed (HTTP ${response.status}).`)
    const body = await response.text()
    if (encoder.encode(body).byteLength > limit) throw new Error('The theme document is too large.')
    return body
  }
  const response = await fetch(target, { signal: combined, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`Theme download failed (HTTP ${response.status}).`)
  if (!response.body) throw new Error('The theme download was empty.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new Error('The theme document is too large.')
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
export async function loadThemeCatalog(signal?: AbortSignal): Promise<{ catalog: ThemeCatalog; cached: boolean; fetchedAt: number }> {
  try {
    const catalog = parseCatalog(JSON.parse(await fetchThemeText(THEME_CATALOG_URL, 1_000_000, signal)))
    const fetchedAt = Date.now()
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ catalog, fetchedAt })) } catch { /* Cache quota must not prevent browsing. */ }
    return { catalog, cached: false, fetchedAt }
  } catch (error) {
    if (signal?.aborted) throw error
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
      if (cached) return { catalog: parseCatalog(cached.catalog), cached: true, fetchedAt: cached.fetchedAt }
    } catch { /* Preserve the original download error. */ }
    throw error
  }
}
export async function verifyRelease(body: string, release: ThemeRelease): Promise<void> {
  const bytes = encoder.encode(body)
  if (bytes.length !== release.bytes) throw new Error('The downloaded theme does not match its listing size.')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== release.sha256) throw new Error('The downloaded theme does not match its listing checksum.')
}
export async function prepareRelease(release: ThemeRelease, origin = THEME_CATALOG_URL, updateUrl?: string, signal?: AbortSignal): Promise<PreparedTheme> {
  if (release.themeApi !== THEME_API) throw new Error('This theme needs a different client theme API.')
  const body = await fetchThemeText(release.download, MAX_THEME_BYTES, signal)
  await verifyRelease(body, release)
  const pkg = parseThemePackage(JSON.parse(body))
  if (pkg.id !== release.id || pkg.version !== release.version) throw new Error('The theme identity or version does not match its listing.')
  return { package: pkg, origin, release, updateUrl }
}
export async function prepareThemeLink(link: string, signal?: AbortSignal): Promise<PreparedTheme> {
  const url = themeUrl(link), raw = JSON.parse(await fetchThemeText(url, MAX_THEME_BYTES, signal))
  if (raw?.app === 'izumi' && raw.kind === 'theme-release' && raw.schemaVersion === 1) return prepareRelease(parseRelease(raw.release), url, url, signal)
  return { package: parseSharedTheme(raw), origin: url }
}
