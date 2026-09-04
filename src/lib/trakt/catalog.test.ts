// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ traktFetch: vi.fn() }))
vi.mock('./client', () => ({ traktFetch: mocks.traktFetch }))

import { hideTraktRecommendation, loadTraktHub, mapTraktMedia } from './catalog'

const rawMovie = {
  title: 'Perfect Days',
  year: 2023,
  ids: { trakt: 912001, tmdb: 976893, imdb: 'tt27503384' },
  images: { poster: ['https://images.example/poster.jpg'], fanart: ['https://images.example/fanart.jpg'] },
  overview: 'A Tokyo toilet cleaner finds beauty in everyday life.',
  rating: 8.1,
  votes: 12000,
  genres: ['drama'],
  certification: 'PG',
  released: '2023-11-10',
}

const rawShow = {
  title: 'Severance',
  year: 2022,
  ids: { trakt: 158448, tmdb: 95396, imdb: 'tt11280740', tvdb: 371980 },
  images: { poster: ['https://images.example/show.jpg'] },
  rating: 8.7,
  network: 'Apple TV+',
  first_aired: '2022-02-18T00:00:00.000Z',
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Trakt catalogue experience', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.traktFetch.mockReset()
  })

  it('maps Trakt metadata to a playable TMDB catalogue identity', () => {
    const mapped = mapTraktMedia(rawMovie, 'movie')
    expect(mapped?.media.catalog).toEqual({ provider: 'tmdb', type: 'movie', id: '976893' })
    expect(mapped?.media.externalIds).toEqual({ tmdb: 976893, imdb: 'tt27503384', tvdb: undefined })
    expect(mapped?.media.coverImage?.large).toBe('https://images.example/poster.jpg')
    expect(mapped?.media.ratings?.[0]).toEqual({ source: 'Trakt', score: 8.1, scale: 10, votes: 12000 })
  })

  it('drops rows that cannot open a provider-native detail page', () => {
    expect(mapTraktMedia({ ...rawMovie, ids: { trakt: 1 } }, 'movie')).toBeNull()
  })

  it('loads recommendations, Watchlist, and history with current paginated endpoints', async () => {
    mocks.traktFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/recommendations/movies')) return response([rawMovie])
      if (path.startsWith('/recommendations/shows')) return response([rawShow])
      if (path.startsWith('/sync/watchlist/movies')) return response([{ listed_at: '2026-01-01T00:00:00.000Z', movie: rawMovie }])
      if (path.startsWith('/sync/watchlist/shows')) return response([{ listed_at: '2026-02-01T00:00:00.000Z', show: rawShow }])
      if (path.startsWith('/sync/history/movies')) return response([{ watched_at: '2026-03-01T00:00:00.000Z', movie: rawMovie }])
      return response([{ watched_at: '2026-04-01T00:00:00.000Z', show: rawShow, episode: { season: 2, number: 4, title: 'Woe’s Hollow' } }])
    })

    const hub = await loadTraktHub()

    expect(hub.movieRecommendations).toHaveLength(1)
    expect(hub.showRecommendations).toHaveLength(1)
    expect(hub.watchlist.map((item) => item.media.title.userPreferred)).toEqual(['Severance', 'Perfect Days'])
    expect(hub.history[0].context).toBe('S2 E4 · Woe’s Hollow')
    expect(mocks.traktFetch.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      '/recommendations/movies?extended=full,images&limit=20&ignore_watchlisted=true',
      '/sync/watchlist/shows/added/desc?extended=full,images&limit=20&page=1',
      '/sync/history/episodes?extended=full,images&limit=30&page=1',
    ]))
  })

  it('keeps successful sections visible when one Trakt endpoint fails', async () => {
    mocks.traktFetch.mockImplementation(async (path: string) =>
      path.startsWith('/recommendations/movies') ? response({ error: 'rate limited' }, 429) : response([]))
    const hub = await loadTraktHub()
    expect(hub.errors.movieRecommendations).toContain('rate limited')
    expect(hub.showRecommendations).toEqual([])
  })

  it('uses the Trakt id to hide a recommendation', async () => {
    mocks.traktFetch.mockResolvedValue(new Response(null, { status: 204 }))
    const item = mapTraktMedia(rawMovie, 'movie')!
    await hideTraktRecommendation(item)
    expect(mocks.traktFetch).toHaveBeenCalledWith('/recommendations/movies/912001', { method: 'DELETE' })
  })
})
