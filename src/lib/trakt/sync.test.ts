// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({ traktFetch: vi.fn() }))
vi.mock('./client', () => ({ traktFetch: mocks.traktFetch }))

import { incognito } from '$lib/stores/incognito'
import { traktHistoryDedupe, traktSyncQueue, traktToken } from './config'
import {
  addTraktHistory,
  buildTraktMediaBody,
  flushTraktSyncQueue,
  setTraktRating,
  setTraktWatchlist,
} from './sync'

function media(overrides: Partial<Media> = {}): Media {
  return {
    id: -1,
    catalog: { provider: 'tmdb', type: 'series', id: '1399' },
    externalIds: { tmdb: 1399, imdb: 'tt0944947' },
    type: 'SERIES',
    title: { userPreferred: 'Game of Thrones' },
    videos: [{ number: 12, season: 2, episode: 2 }],
    ...overrides,
  }
}

describe('Trakt media sync', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.traktFetch.mockReset()
    mocks.traktFetch.mockResolvedValue(new Response('{}', { status: 201 }))
    traktToken.set('token')
    traktSyncQueue.set([])
    traktHistoryDedupe.set({})
    incognito.set(false)
  })

  it('addresses movies by TMDB/IMDb and shows by provider season/episode', () => {
    expect(buildTraktMediaBody(media({ type: 'MOVIE', format: 'MOVIE', catalog: { provider: 'tmdb', type: 'movie', id: '550' }, externalIds: { tmdb: 550, imdb: 'tt0137523' } }), 1)).toEqual({
      movies: [{ ids: { imdb: 'tt0137523', tmdb: 550 } }],
    })
    expect(buildTraktMediaBody(media(), 12)).toEqual({
      shows: [{
        ids: { imdb: 'tt0944947', tmdb: 1399 },
        seasons: [{ number: 2, episodes: [{ number: 2 }] }],
      }],
    })
  })

  it('prefers an exact AniZip TVDB episode id when available', () => {
    expect(buildTraktMediaBody(media({ externalIds: undefined }), 12, { tvdbEId: 4517451 })).toEqual({
      episodes: [{ ids: { tvdb: 4517451 } }],
    })
  })

  it('does not invent a Trakt identity when no supported id exists', () => {
    expect(buildTraktMediaBody(media({ catalog: { provider: 'stremio', type: 'series', id: 'local' }, externalIds: undefined }), 1)).toBeNull()
  })

  it('deduplicates one playback while preserving the exact episode payload', async () => {
    await addTraktHistory(media(), 12)
    await addTraktHistory(media(), 12)

    expect(mocks.traktFetch).toHaveBeenCalledTimes(1)
    const [path, init] = mocks.traktFetch.mock.calls[0]
    expect(path).toBe('/sync/history')
    expect(JSON.parse(init.body)).toEqual({
      shows: [{
        ids: { imdb: 'tt0944947', tmdb: 1399 },
        seasons: [{ number: 2, episodes: [{ number: 2 }] }],
      }],
    })
  })

  it.each(['movie', 'series'])('retains the original watched_at when recovering a %s', async type => {
    const at = Date.UTC(2026, 7, 2, 12)
    const item = type === 'movie' ? media({ catalog: { provider: 'tmdb', type: 'movie', id: '77' } }) : media()
    await addTraktHistory(item, 12, at)
    const body = JSON.parse(mocks.traktFetch.mock.calls[0][1].body)
    const event = type === 'movie' ? body.movies[0] : body.shows[0].seasons[0].episodes[0]
    expect(event.watched_at).toBe(new Date(at).toISOString())
  })

  it('queues an offline write and flushes it when Trakt returns', async () => {
    mocks.traktFetch.mockRejectedValueOnce(new Error('offline'))
    await setTraktWatchlist(media(), true)
    expect(get(traktSyncQueue)).toEqual([
      expect.objectContaining({ path: '/sync/watchlist' }),
    ])

    mocks.traktFetch.mockResolvedValue(new Response('{}', { status: 201 }))
    await flushTraktSyncQueue()
    expect(get(traktSyncQueue)).toEqual([])
  })

  it('maps the canonical score to Trakt 1–10 ratings and removes zero', async () => {
    await setTraktRating(media(), 76)
    await setTraktRating(media(), 0)
    expect(mocks.traktFetch.mock.calls.map(([path]) => path)).toEqual(['/sync/ratings', '/sync/ratings/remove'])
    expect(JSON.parse(mocks.traktFetch.mock.calls[0][1].body).shows[0].rating).toBe(8)
  })

  it('never contacts Trakt in incognito mode', async () => {
    incognito.set(true)
    await addTraktHistory(media(), 12)
    await setTraktWatchlist(media(), true)
    expect(mocks.traktFetch).not.toHaveBeenCalled()
  })
})
