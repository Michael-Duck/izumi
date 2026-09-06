import { describe, expect, it } from 'vitest'
import { manifestFetchUrls, normalizeManifest, resolveManifestUrl } from './catalog'
import { classifySourceSpec } from '$lib/settings/classify-source-spec'

const manifest = { name: 'Example repository', scrapers: [{
  id: 'example', name: 'Example', version: '1.2', filename: 'providers/example.js?version=2',
  logo: 'images/logo.png', contentLanguage: ['en'], supportedTypes: ['movie', 'tv'], enabled: true,
}] }
const url = 'https://example.test/repo/manifest.json'

describe('Nuvio source installation', () => {
  it('normalizes metadata and preserves signed module URLs', () => {
    expect(normalizeManifest(manifest, url)).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^nuvio:[a-f0-9]{8}:example$/), name: 'Example', version: '1.2',
      code: 'https://example.test/repo/providers/example.js?version=2', icon: 'https://example.test/repo/images/logo.png',
      lang: 'en', runtime: 'nuvio', type: 'onlinestream-provider', supportedTypes: ['movie', 'tv'],
    })])
  })

  it('keeps fork ids distinct and accepts standalone entries', () => {
    const [entry] = normalizeManifest(manifest, url)
    expect(normalizeManifest(manifest.scrapers, url)[0]).toEqual(entry)
    expect(normalizeManifest(manifest.scrapers[0], url)[0]).toEqual(entry)
    expect(normalizeManifest(manifest, 'https://fork.test/manifest.json')[0].id).not.toBe(entry.id)
  })

  it('skips disabled, malformed and non-video providers without losing valid siblings', () => {
    const valid = manifest.scrapers[0]
    const entries = [null, { ...valid, enabled: false }, { ...valid, supportedTypes: ['live'] },
      { ...valid, filename: 'file:///secret.js' }, { ...valid, filename: 'bad.cs3' }, valid]
    expect(normalizeManifest({ scrapers: entries }, url)).toHaveLength(1)
    expect(normalizeManifest({ scrapers: [{ ...valid, contentLanguage: ['en', 'fr'] }] }, url)[0].lang).toBeUndefined()
  })

  it('stores the fetched manifest when a repository base URL is pasted', async () => {
    const visited: string[] = []
    expect(await classifySourceSpec('https://example.test/repo/', async (url) => {
      visited.push(url); return manifest
    })).toEqual({ kind: 'extension', spec: url })
    expect(visited).toEqual([url])
  })

  it('recognizes empty Nuvio repositories so Sources can explain why nothing runs', async () => {
    expect(await classifySourceSpec(url, async () => ({ scrapers: [] }))).toEqual({ kind: 'extension', spec: url })
  })

  it('accepts GitHub repository, file and raw directory links', () => {
    expect(resolveManifestUrl('https://github.com/owner/repo')).toBe('https://raw.githubusercontent.com/owner/repo/HEAD/manifest.json')
    expect(resolveManifestUrl('https://github.com/owner/repo/blob/main/manifest.json')).toBe('https://raw.githubusercontent.com/owner/repo/main/manifest.json')
    expect(resolveManifestUrl('https://raw.githubusercontent.com/owner/repo/refs/heads/main/')).toBe('https://raw.githubusercontent.com/owner/repo/refs/heads/main/manifest.json')
    expect(manifestFetchUrls('owner/repo')).toEqual([
      'https://esm.sh/gh/owner/repo/index.json', 'https://raw.githubusercontent.com/owner/repo/HEAD/manifest.json',
    ])
  })

  it('keeps Nuvio and Omni Stremio add-ons on the existing add-on path', async () => {
    const addon = { id: 'org.example.streams', name: 'Example streams', resources: ['stream'], types: ['movie', 'series'] }
    expect(await classifySourceSpec('stremio://addon.test/config/manifest.json')).toEqual({ kind: 'addon', spec: 'https://addon.test/config' })
    expect(await classifySourceSpec('https://addon.test/config/manifest.json', async () => addon)).toEqual({ kind: 'addon', spec: 'https://addon.test/config' })
  })
})
