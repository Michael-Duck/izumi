import { afterEach, expect, it, vi } from 'vitest'
import { collectionOptions, collectionSnapshot, normalizeCollections } from '../src/collection-catalog.js'
import { defaultResolverProfile } from '../src/resolver.js'

const collections = normalizeCollections([{ id: 'films', title: 'Film nights', folders: [{ id: 'mysteries', title: 'Mystery', tileShape: 'LANDSCAPE', coverImageUrl: 'https://images.example/mystery.jpg', catalogSources: [{ addonId: 'addon.example', type: 'movie', catalogId: 'movies,legacy', genre: 'Mystery' }] }] }])
const screen = collectionOptions(collections, 'nc')[0].children[0].screen
const profile = () => ({ ...defaultResolverProfile(), addons: ['https://addon.example/config?token=fixture'] })
afterEach(() => vi.unstubAllGlobals())

it('preserves Nuvio folder artwork and produces stable addressable catalogue options', () => {
  expect(collectionOptions(collections, 'nc')).toMatchObject([{ label: 'Film nights', children: [{ screen, label: 'Mystery', shape: 'landscape', cover: 'https://images.example/mystery.jpg' }] }])
  expect(screen.length).toBeLessThan(40)
  expect(collectionOptions([...collections].reverse(), 'nc')[0].children[0].screen).toBe(screen)
})

it('uses installed manifests, legacy catalogue IDs, exact genre encoding, and variable-sized skip pages', async () => {
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input)
    return Response.json(url.pathname.endsWith('/manifest.json')
      ? { id: 'addon.example', catalogs: [{ id: 'movies', type: 'movie', extra: [{ name: 'genre', options: ['Mystery'] }, { name: 'skip' }] }] }
      : { metas: [{ id: 'tt123', name: 'Mystery film', type: 'movie' }, { id: 'tt124', name: 'Another film', type: 'movie' }] })
  })
  vi.stubGlobal('fetch', fetcher)
  const first = await collectionSnapshot(profile(), collections, screen, 'nc')
  expect(first?.rows[0].items).toHaveLength(2)
  expect(first?.collectionPage).toMatchObject({ hasMore: true, nextOffsets: [2] })
  expect(fetcher.mock.calls[1][0]).toBe('https://addon.example/config/catalog/movie/movies/genre=Mystery.json?token=fixture')
  await collectionSnapshot(profile(), collections, screen, 'nc', 2, first!.collectionPage.nextOffsets)
  expect(fetcher.mock.calls[3][0]).toContain('/genre=Mystery&skip=2.json?token=fixture')
})

it('reports missing or unsupported sources inside the folder rather than substituting unrelated titles', async () => {
  const result = await collectionSnapshot({ ...profile(), addons: [] }, collections, screen, 'nc')
  expect(result?.rows).toEqual([])
  expect(result?.collectionPage.errors[0]).toContain('Enable addon.example')
  expect(await collectionSnapshot(profile(), collections, 'nc-missing', 'nc')).toBeNull()
})

it('does not drop collection filters that the Worker cannot honor', async () => {
  const input = normalizeCollections([{ id: 'x', title: 'X', folders: [{ id: 'y', title: 'Y', sources: [{ provider: 'tmdb', tmdbSourceType: 'DISCOVER', filters: { unsupportedFilter: 'sensitive-curation' } }] }] }])
  const id = collectionOptions(input, 'lc')[0].children[0].screen
  const result = await collectionSnapshot({ ...profile(), addons: [] }, input, id, 'lc')
  expect(result?.collectionPage.errors[0]).toContain('unsupported TMDB filter')
  expect(result?.rows).toEqual([])
})
