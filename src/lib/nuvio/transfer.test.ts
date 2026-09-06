import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'
import { importCloudItems, localCloudItems, importCloudAddons, localCloudAddons, localCloudSettings, importCloudSettings } from './transfer'
import { localLibrary, setMediaInLocalList } from '$lib/library/local-lists'
import { durableHistory } from '$lib/player/history'
import { durablePositions } from '$lib/player/progress'
import { incognito } from '$lib/stores/incognito'
import { addonUrls, disabledSources } from '$lib/stremio/sources'
import { fetchManifest } from '$lib/stremio/manifest'
import { mapStremioMeta } from '$lib/catalog/providers/stremio'
import { mediaKey } from '$lib/catalog/identity'
import { persisted } from 'svelte-persisted-store'
vi.mock('$lib/library/local-lists', async () => ({ localLibrary: Object.assign((await import('svelte/store')).writable({ entries: {}, lists: [] }), { ready: Promise.resolve() }), WATCHLIST_ID: 'watchlist', setMediaInLocalList: vi.fn() }))
vi.mock('$lib/player/history', async () => ({ durableHistory: Object.assign((await import('svelte/store')).writable({}), { ready: Promise.resolve() }), mediaSnapshot: (media: unknown) => media }))
vi.mock('$lib/player/progress', async () => ({ durablePositions: (await import('svelte/store')).writable({}), progressKey: (id: number, ep: number) => `${id}:${ep}` }))
vi.mock('$lib/stremio/manifest', () => ({ fetchManifest: vi.fn() }))
vi.mock('$lib/catalog/registry', () => ({ loadCatalogProvider: vi.fn() }))
const series = mapStremioMeta({ id: 'tt123', type: 'series', name: 'Series', videos: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 2, episode: 1 }] }, 'https://metadata.test')!
const movie = mapStremioMeta({ id: 'tt456', type: 'movie', name: 'Movie' }, 'https://metadata.test')!
beforeEach(() => {
  vi.clearAllMocks(); localLibrary.set({ lists: [], entries: {} }); durableHistory.set({}); durablePositions.set({}); incognito.set(false); addonUrls.set([]); disabledSources.set([])
})
describe('reviewed Nuvio transfers', () => {
  it('exports only Watchlist membership, without unrelated lists or unsupported titles', async () => {
    localLibrary.set({ lists: [], entries: {
      [mediaKey(movie)]: { media: movie, listIds: ['watchlist'], addedAt: 100, updatedAt: 100 },
      [mediaKey(series)]: { media: series, listIds: ['custom-list'], addedAt: 100, updatedAt: 100 },
    } })
    expect((await localCloudItems('library')).items).toMatchObject([{ content_id: 'tt456', added_at: 100 }])
  })
  it('converts seconds to milliseconds and exports precise episode coordinates', async () => {
    durableHistory.set({ [series.id]: { media: series, episode: 3, progress: 2, updatedAt: 1000 } })
    durablePositions.set({ [`${series.id}:3`]: { pos: 120.5, dur: 3600, updatedAt: 2000 }, [`${series.id}:2`]: { pos: 0, dur: 3600, cleared: true, updatedAt: 1000 } })
    expect((await localCloudItems('progress')).items).toEqual([{ content_id: 'tt123', content_type: 'series', season: 2, episode: 1, video_id: 'tt123:2:1', progress_key: 'tt123_s2e1', position: 120500, duration: 3600000, last_watched: 2000 }])
    expect((await localCloudItems('history')).items.map((row) => [row.season, row.episode])).toEqual([[1, 1], [1, 2]])
  })
  it('converts resume points into the existing sequential player position and respects newer local clocks', async () => {
    durableHistory.set({ [series.id]: { media: series, episode: 1, progress: 0, updatedAt: 1000 } })
    const row = { content_id: 'tt123', content_type: 'series' as const, season: 2, episode: 1, position: 180000, duration: 3600000, last_watched: 2000 }
    expect(await importCloudItems('progress', [row])).toEqual({ imported: 1, skipped: 0 })
    expect(get(durablePositions)[`${series.id}:3`]).toEqual({ pos: 180, dur: 3600, updatedAt: 2000 })
    expect(get(durableHistory)[series.id].episode).toBe(3)
    expect(await importCloudItems('progress', [{ ...row, position: 10000, last_watched: 1500 }])).toEqual({ imported: 0, skipped: 1 })
    expect(get(durablePositions)[`${series.id}:3`].pos).toBe(180)
  })
  it('does not mark unwatched episode gaps as completed', async () => {
    durableHistory.set({ [series.id]: { media: series, episode: 1, progress: 0, updatedAt: 100 } })
    expect(await importCloudItems('history', [{ content_id: 'tt123', content_type: 'series', season: 2, episode: 1, watched_at: 1000 }])).toEqual({ imported: 0, skipped: 1 })
    expect(get(durableHistory)[series.id].progress).toBe(0)
  })
  it('keeps incognito data out of both transfer directions', async () => {
    incognito.set(true)
    await expect(localCloudItems('progress')).rejects.toThrow('incognito')
    await expect(importCloudItems('library', [{ content_id: 'tt456', content_type: 'movie' }])).rejects.toThrow('incognito')
    expect(setMediaInLocalList).not.toHaveBeenCalled()
  })
  it('validates all selected sources before changing the installed list and preserves disabled locals', async () => {
    addonUrls.set(['https://already.test']); disabledSources.set(['https://already.test'])
    vi.mocked(fetchManifest).mockResolvedValueOnce({ id: 'ok', name: 'OK', version: '1' }).mockResolvedValueOnce(null)
    await expect(importCloudAddons([{ url: 'https://new.test/manifest.json' }, { url: 'https://broken.test/manifest.json' }])).rejects.toThrow('No sources were added')
    expect(get(addonUrls)).toEqual(['https://already.test'])
    expect(get(disabledSources)).toEqual(['https://already.test'])
  })
  it('puts the manifest path before query credentials', () => {
    addonUrls.set(['https://configured.test/addon?token=private'])
    expect(localCloudAddons()[0].url).toBe('https://configured.test/addon/manifest.json?token=private')
  })
  it('captures only portable settings and refuses arbitrary account/token keys on import', () => {
    const storage = new Map([['title-language', '"english"'], ['nuvio-auth-tokens-v1', '"secret"'], ['catalog-home-layouts-v1', '{"rows":[]}']])
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null })
    expect(localCloudSettings('settings')).toEqual({ 'title-language': 'english' })
    expect(localCloudSettings('home')).toEqual({ 'catalog-home-layouts-v1': { rows: [] } })
    expect(importCloudSettings('settings', { 'title-language': 'native', 'nuvio-auth-tokens-v1': 'injected' })).toBe(1)
    expect(get(persisted('title-language', 'romaji'))).toBe('native')
    vi.unstubAllGlobals()
  })
})
