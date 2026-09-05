import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), malFetch: vi.fn(), index: vi.fn() }))
vi.mock('$lib/anilist/client', () => ({ anilist: { query: mocks.query, mutation: mocks.mutation } }))
vi.mock('$lib/trakt/sync', () => ({ setTraktWatchlist: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./mal-auth', () => ({ malFetch: mocks.malFetch }))
vi.mock('$lib/stremio/idmap', async (original) => ({
  ...await original<typeof import('$lib/stremio/idmap')>(), getIndex: mocks.index,
}))

import { removeFromList } from './index'
import { anilistToken, malToken, kitsuToken, simklToken } from './config'
import { trackerQueue } from './queue'
import { localLibrary, localTrackingRemoved } from '$lib/library/local-lists'
import { durableHistory, sessionProgress } from '$lib/player/history'
import { continueWatching, cwSnapshot, cwDismissed } from '$lib/player/continue-watching'
import { incognito } from '$lib/stores/incognito'
import type { Media } from '$lib/anilist/types'

const bleach: Media = { id: 185874, title: { english: 'BLEACH' }, episodes: 10, status: 'FINISHED' }
const fallback: Media = {
  ...bleach, id: -123, catalog: { provider: 'kitsu', type: 'anime', id: '50000' },
  externalIds: { anilist: bleach.id },
}
const result = (data: unknown) => ({ toPromise: async () => data })

function reset() {
  anilistToken.set(null); malToken.set(null); kitsuToken.set(null); simklToken.set(null)
  incognito.set(false)
  localLibrary.set({ lists: [], entries: {} })
  durableHistory.set({}); sessionProgress.set({}); cwSnapshot.set([]); cwDismissed.set({}); trackerQueue.set([])
}

beforeEach(() => {
  reset()
  mocks.query.mockReset().mockReturnValue(result({ data: { Media: { mediaListEntry: { id: 987 } } } }))
  mocks.mutation.mockReset().mockReturnValue(result({ data: { DeleteMediaListEntry: { deleted: true } } }))
  mocks.malFetch.mockReset().mockResolvedValue(new Response('', { status: 200 }))
  mocks.index.mockReset().mockResolvedValue(new Map([[bleach.id, { anilist_id: bleach.id, mal_id: 60636 }]]))
})
afterEach(reset)

describe('removing followed shows', () => {
  it('hides old history and cached Continue Watching immediately, even with no tracker connected', async () => {
    durableHistory.set({ [bleach.id]: { media: bleach, episode: 2, progress: 1, updatedAt: 1 } })
    cwSnapshot.set([{ media: bleach, progress: 1, updatedAt: 1, source: 'tracker' }])
    expect(get(continueWatching)).toHaveLength(1)
    await removeFromList(fallback)
    expect(get(continueWatching)).toEqual([])
    expect(get(durableHistory)[bleach.id].progress).toBe(1) // removal preserves playback history
    // A late network response must not restore the card.
    cwSnapshot.set([{ media: bleach, progress: 1, updatedAt: 2, source: 'tracker' }])
    expect(get(continueWatching)).toEqual([])
  })

  it('resolves a missing AniList entry id using the fallback card’s canonical id', async () => {
    anilistToken.set('test')
    expect(await removeFromList(fallback)).toEqual(['AniList'])
    expect(mocks.query.mock.calls[0][1]).toEqual({ mediaId: bleach.id })
    expect(mocks.query.mock.calls[0][2]).toEqual({ requestPolicy: 'network-only' })
    expect(mocks.mutation.mock.calls[0][1]).toEqual({ id: 987 })
  })

  it('retains an offline removal for retry and still removes the local item', async () => {
    anilistToken.set('test')
    mocks.query.mockReturnValue(result({ error: { networkError: new Error('offline') } }))
    expect(await removeFromList(fallback)).toEqual([])
    expect(localTrackingRemoved(get(localLibrary), bleach)).toBe(true)
    expect(get(trackerQueue)).toEqual([expect.objectContaining({
      tracker: 'AniList', op: expect.objectContaining({ kind: 'remove', idAniList: bleach.id }),
    })])
    expect(mocks.mutation).not.toHaveBeenCalled()
  })

  it('removes a Kitsu fallback card from MAL even when it has no embedded MAL id', async () => {
    malToken.set('test')
    expect(await removeFromList(fallback)).toEqual(['MAL'])
    expect(mocks.malFetch).toHaveBeenCalledWith('https://api.myanimelist.net/v2/anime/60636/my_list_status', { method: 'DELETE' })
  })

  it('queues a MAL removal when the fallback ID map is unavailable', async () => {
    malToken.set('test')
    mocks.index.mockResolvedValue(new Map())
    await removeFromList(fallback)
    expect(get(trackerQueue)).toEqual([expect.objectContaining({ tracker: 'MAL', op: expect.objectContaining({ kind: 'remove' }) })])
    expect(mocks.malFetch).not.toHaveBeenCalled()
  })

  it('treats an already-absent entry as success without sending a delete', async () => {
    anilistToken.set('test')
    mocks.query.mockReturnValue(result({ data: { Media: { mediaListEntry: null } } }))
    expect(await removeFromList(fallback)).toEqual(['AniList'])
    expect(mocks.mutation).not.toHaveBeenCalled()
  })

  it('does not persist or send a removal in incognito', async () => {
    anilistToken.set('test')
    incognito.set(true)
    await removeFromList(fallback)
    expect(localTrackingRemoved(get(localLibrary), bleach)).toBe(false)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.mutation).not.toHaveBeenCalled()
  })
})
