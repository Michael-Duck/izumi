import { beforeEach, describe, expect, it, vi } from 'vitest'
import { phttp } from '$lib/net/http'
import { tmdb } from '../providers/tmdb'
import { traktFetch } from '$lib/trakt/client'
import { collectionTmdbRequest, loadCollectionSource, resolveCollectionAddon, type InstalledCollectionAddon } from './resolve'
import type { CollectionSource } from './model'

vi.mock('$lib/net/http', () => ({ phttp: vi.fn() }))
vi.mock('../providers/tmdb', async (original) => ({ ...await original<typeof import('../providers/tmdb')>(), tmdb: vi.fn() }))
vi.mock('$lib/trakt/client', () => ({ traktFetch: vi.fn() }))
const addon: InstalledCollectionAddon = {
  base: 'https://addon.test/user-config',
  manifest: { id: 'catalog.one', name: 'Catalog', version: '1', catalogs: [
    { id: 'curated', type: 'movie', name: 'Movies', extra: [{ name: 'genre', options: ['Drama'] }, { name: 'skip' }] },
  ] },
}
const addonSource: CollectionSource = { provider: 'addon', addonId: 'catalog.one', type: 'movie', catalogId: 'curated', genre: 'Drama' }

beforeEach(() => vi.clearAllMocks())
describe('Nuvio catalog resolution', () => {
  it('prioritizes the declared add-on and matches configured replacement catalogs by exact type/id', () => {
    const other = { ...addon, base: 'https://other.test', manifest: { ...addon.manifest, id: 'other' } }
    expect(resolveCollectionAddon(addonSource, [other, addon])?.base).toBe(addon.base)
    expect(resolveCollectionAddon(addonSource, [other])?.base).toBe(other.base)
    expect(resolveCollectionAddon({ ...addonSource, type: 'series' }, [addon])).toBeUndefined()
    expect(resolveCollectionAddon({ ...addonSource, catalogId: 'curated,legacy' }, [addon])?.catalog.id).toBe('curated')
    expect(resolveCollectionAddon({ ...addonSource, catalogId: 'curated,legacy' }, [other])).toBeUndefined()
  })
  it('preserves TV discover filters, watch region, dates, sorting and pagination', () => {
    expect(collectionTmdbRequest({ provider: 'tmdb', tmdbSourceType: 'NETWORK', tmdbId: 213, sortBy: 'primary_release_date.desc', filters: {
      withGenres: '16|10765', withoutKeywords: '123', releaseDateGte: '2020-01-01', year: 2025,
      voteAverageGte: 7, withWatchProviders: '8', watchRegion: 'GB', withOriginalLanguage: 'ja',
    } }, 2)).toMatchObject({ path: '/discover/tv', kind: 'tv', params: {
      page: 2, sort_by: 'first_air_date.desc', with_networks: 213, with_genres: '16|10765', without_keywords: '123',
      'first_air_date.gte': '2020-01-01', first_air_date_year: 2025, 'vote_average.gte': 7,
      with_watch_providers: '8', watch_region: 'GB', with_original_language: 'ja',
    } })
  })
  it('does not broaden a collection by dropping an unknown filter', () => {
    expect(() => collectionTmdbRequest({ provider: 'tmdb', tmdbSourceType: 'DISCOVER', filters: { futureFamilySafetyFilter: 'strict' } })).toThrow('unsupported TMDB filter')
  })
  it('requests the selected genre and advances Stremio skip using raw result counts', async () => {
    vi.mocked(phttp).mockResolvedValue(new Response(JSON.stringify({ metas: [
      { id: 'tt1', name: 'One' }, { id: 'tt1', name: 'Duplicate' }, { id: 'tt2', name: 'Two' },
    ] })))
    const result = await loadCollectionSource(addonSource, 11, undefined, [addon])
    expect(vi.mocked(phttp).mock.calls[0][0]).toBe('https://addon.test/user-config/catalog/movie/curated/genre=Drama&skip=10.json')
    expect(result.media).toHaveLength(2)
    expect(result.next).toBe(14)
  })
  it('rejects missing add-ons and required filters without fetching arbitrary manifests', async () => {
    await expect(loadCollectionSource(addonSource, 1, undefined, [])).rejects.toThrow('Settings → Sources')
    await expect(loadCollectionSource({ ...addonSource, genre: 'Missing' }, 1, undefined, [addon])).rejects.toThrow('does not provide')
    expect(phttp).not.toHaveBeenCalled()
  })
  it('loads director filmographies without unrelated cast or television credits', async () => {
    vi.mocked(tmdb).mockResolvedValue({ crew: [
      { id: 1, title: 'Directed movie', media_type: 'movie', job: 'Director' },
      { id: 2, name: 'Directed show', media_type: 'tv', job: 'Director' },
      { id: 3, title: 'Produced movie', media_type: 'movie', job: 'Producer' },
    ] })
    const result = await loadCollectionSource({ provider: 'tmdb', tmdbSourceType: 'DIRECTOR', tmdbId: 42, mediaType: 'movie' })
    expect(result.media.map((media) => media.catalog?.id)).toEqual(['1'])
    expect(result.next).toBeUndefined()
  })
  it('maps mixed TMDB list results and respects total_pages', async () => {
    vi.mocked(tmdb).mockResolvedValue({ items: [{ id: 1, title: 'Movie' }, { id: 2, name: 'Show', media_type: 'tv' }], total_pages: 2 })
    const result = await loadCollectionSource({ provider: 'tmdb', tmdbSourceType: 'LIST', tmdbId: 42 }, 1)
    expect(result.media.map((media) => media.catalog?.type)).toEqual(['movie', 'series'])
    expect(result.next).toBe(2)
  })
  it('uses server-side Trakt sorting and pagination', async () => {
    vi.mocked(traktFetch).mockResolvedValue(new Response(JSON.stringify([{ movie: { title: 'Movie', ids: { trakt: 1, tmdb: 2 } } }]), { headers: { 'X-Pagination-Page-Count': '4' } }))
    const result = await loadCollectionSource({ provider: 'trakt', traktListId: 55, sortBy: 'released', sortHow: 'desc' }, 2)
    expect(vi.mocked(traktFetch).mock.calls[0][0]).toBe('/lists/55/items/movie/released/desc?extended=full,images&page=2&limit=50')
    expect(result.next).toBe(3)
    expect(result.media[0].catalog).toMatchObject({ provider: 'tmdb', id: '2' })
  })
  it('stops before any request when navigation has been aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(loadCollectionSource(addonSource, 1, abort.signal, [addon])).rejects.toMatchObject({ name: 'AbortError' })
    expect(phttp).not.toHaveBeenCalled()
  })
})
