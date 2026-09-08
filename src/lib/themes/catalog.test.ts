// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { fetchThemeText, loadThemeCatalog, prepareThemeLink, verifyRelease } from './catalog'
import { MAX_THEME_BYTES, parseRelease } from './packages'
vi.mock('$lib/net/http', () => ({ phttp: vi.fn() }))
const pkg = { app: 'izumi', kind: 'theme-package', schemaVersion: 1, themeApi: 1, id: 'test.cinema', name: 'Cinema', author: 'Test', description: 'Cinema presentation.', version: '1.0.0', design: {} }
async function release(body: string) {
  const bytes = new TextEncoder().encode(body), hash = await webcrypto.subtle.digest('SHA-256', bytes)
  return parseRelease({ ...pkg, tags: [], download: 'https://example.test/package.json', bytes: bytes.length, sha256: Buffer.from(hash).toString('hex') })
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => vi.unstubAllGlobals())
describe('theme downloads', () => {
  it('uses one verified install pipeline for release links', async () => {
    const body = JSON.stringify(pkg), entry = await release(body)
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ app: 'izumi', kind: 'theme-release', schemaVersion: 1, release: entry }))).mockResolvedValueOnce(new Response(body))
    vi.stubGlobal('fetch', request)
    const prepared = await prepareThemeLink('https://example.test/release.json')
    expect(prepared.package.id).toBe(pkg.id); expect(prepared.updateUrl).toBe('https://example.test/release.json')
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  })
  it('rejects modified packages before activation', async () => {
    const body = JSON.stringify(pkg), entry = await release(body)
    await expect(verifyRelease(body.replace('Cinema', 'cinema'), entry)).rejects.toThrow('checksum')
    await expect(verifyRelease(body + ' ', entry)).rejects.toThrow('size')
  })
  it('keeps a last valid catalog for offline browsing', async () => {
    const catalog = { app: 'izumi', kind: 'theme-catalog', schemaVersion: 1, themes: [await release(JSON.stringify(pkg))] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(catalog))).mockRejectedValueOnce(new Error('offline')))
    expect((await loadThemeCatalog()).cached).toBe(false)
    const cached = await loadThemeCatalog(); expect(cached.cached).toBe(true); expect(cached.catalog.themes[0].id).toBe(pkg.id)
  })
  it('bounds downloads even when content-length is omitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(MAX_THEME_BYTES + 1))))
    await expect(fetchThemeText('https://example.test/large.json')).rejects.toThrow('large')
  })
})
