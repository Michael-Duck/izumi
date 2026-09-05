import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ search: vi.fn(), home: vi.fn() }))
vi.mock('$lib/catalog/merged-search', () => ({ searchMergedCatalogs: mocks.search }))
vi.mock('$lib/catalog/registry', () => ({ loadCatalogProvider: async () => ({ home: mocks.home }) }))
vi.mock('$lib/anilist/client', () => ({ anilist: {} }))
import { loadDiscoveryCandidates } from './candidates'
const media = (id: number) => ({ id, title: { english: String(id) } })
beforeEach(() => { vi.resetAllMocks() })
describe('cross-catalog candidates', () => {
  it('keeps non-searchable add-on home lists and anime when TMDB is unavailable', async () => {
    mocks.home.mockResolvedValue({ hero: [], sections: [{ media: [media(2)] }] })
    mocks.search.mockImplementation(async ([provider]: string[]) => {
      if (provider === 'tmdb') throw new Error('No token')
      return { media: [media(1)], hasNextPage: true }
    })
    const result = await loadDiscoveryCandidates(['auto', 'tmdb', 'stremio'])
    expect(result.media.map(item => item.id)).toEqual([1, 2])
    expect(result.failedProviders).toEqual(['tmdb'])
  })
  it('does not query catalogs that the user disabled', async () => {
    mocks.search.mockResolvedValue({ media: [media(1)], hasNextPage: false })
    await loadDiscoveryCandidates(['kitsu'])
    expect(mocks.search).toHaveBeenCalledOnce()
    expect(mocks.search.mock.calls[0][0]).toEqual(['kitsu'])
    expect(mocks.home).not.toHaveBeenCalled()
  })
  it('discards stale results after cancellation', async () => {
    const controller = new AbortController()
    mocks.search.mockImplementation(async () => { controller.abort(); return { media: [media(1)] } })
    await expect(loadDiscoveryCandidates(['auto'], 1, controller.signal)).rejects.toThrow('cancelled')
  })
})
