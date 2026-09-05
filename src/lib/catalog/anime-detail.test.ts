import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { airedCount, mediaHref } from '$lib/anilist/media'
import { anilistIdOf, compatibilityMediaId, type MediaRef } from './identity'
import type { CatalogProvider } from './types'
import {
  animeDetailSource, animeEpisodeMetadata, animeEpisodeNumbers, animeResumeEpisode,
  animeWatchedProgress, normalizeAnimeDetail, usesAnimeDetail, type AnimeDetailState,
} from './anime-detail'

const ref: MediaRef = { provider: 'kitsu', type: 'anime', id: '48293' }
const base: Media = {
  id: compatibilityMediaId(ref), catalog: ref, type: 'ANIME',
  title: { english: 'Ascendance of a Bookworm Season 4' }, episodes: 24, status: 'RELEASING',
}

function providerLoader(detail: CatalogProvider['detail']) {
  return vi.fn().mockResolvedValue({ detail })
}

describe('provider anime detail routing', () => {
  it.each(['kitsu', 'jvm', 'stremio', 'anilist'] as const)('uses the anime presentation for %s anime', (provider) => {
    expect(usesAnimeDetail({ ...ref, provider })).toBe(true)
  })

  it.each(['movie', 'series', 'manga'] as const)('keeps %s out of the anime presentation', (type) => {
    expect(usesAnimeDetail({ provider: 'tmdb', type, id: '42' })).toBe(false)
  })

  it('loads unmapped Kitsu data directly while preserving saved links and native playback ids', async () => {
    const videos = [{ id: 'kitsu-episode-20', number: 20, title: 'Native episode title' }]
    const detail = vi.fn().mockResolvedValue({ ...base, videos })
    const loader = providerLoader(detail)
    const states: AnimeDetailState[] = []
    const unsubscribe = animeDetailSource(ref, false, loader).subscribe((state) => states.push(state))
    await vi.waitFor(() => expect(states.at(-1)?.data?.Media).toBeTruthy())
    const media = states.at(-1)!.data!.Media!
    expect(states[0]).toEqual({ fetching: true })
    expect(loader).toHaveBeenCalledExactlyOnceWith('kitsu')
    expect(detail).toHaveBeenCalledWith(ref, expect.any(AbortSignal))
    expect(media.id).toBe(base.id)
    expect(media.catalog).toBe(ref)
    expect(media.videos).toBe(videos)
    expect(anilistIdOf(media)).toBeUndefined()
    expect(mediaHref(media)).toBe('/app/media/kitsu/anime/48293')
    unsubscribe()
  })

  it('does not load a provider offline', () => {
    const loader = providerLoader(vi.fn())
    expect(get(animeDetailSource(ref, true, loader))).toEqual({ fetching: false })
    expect(loader).not.toHaveBeenCalled()
  })

  it('aborts an in-flight navigation and discards its late result', async () => {
    let finish!: (media: Media) => void
    const detail = vi.fn().mockReturnValue(new Promise<Media>((resolve) => { finish = resolve }))
    const states: AnimeDetailState[] = []
    const unsubscribe = animeDetailSource(ref, false, providerLoader(detail)).subscribe((state) => states.push(state))
    await vi.waitFor(() => expect(detail).toHaveBeenCalledOnce())
    unsubscribe()
    expect(detail.mock.calls[0][1].aborted).toBe(true)
    finish(base)
    await Promise.resolve()
    expect(states).toEqual([{ fetching: true }])
  })

  it.each([null, new Error('Provider unavailable')])('settles missing or failed provider results: %s', async (result) => {
    const detail = result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result)
    let state: AnimeDetailState = { fetching: true }
    const unsubscribe = animeDetailSource(ref, false, providerLoader(detail)).subscribe((value) => { state = value })
    await vi.waitFor(() => expect(state.fetching).toBe(false))
    if (result instanceof Error) expect(state.error?.message).toBe('Provider unavailable')
    else expect(state.data?.Media).toBeNull()
    unsubscribe()
  })
})

describe('native data in the shared anime episode UI', () => {
  it('uses dated releases without promoting planned Kitsu placeholders to aired episodes', () => {
    const now = Date.now()
    const media = normalizeAnimeDetail({ ...base, videos: [
      { number: 19, released: new Date(now - 86400000).toISOString() },
      { number: 20, released: new Date(now + 86400000).toISOString() },
      { number: 24 },
    ] }, now)
    expect(airedCount(media)).toBe(19)
    expect(animeEpisodeNumbers(media)).toEqual([19, 20, 24])
    expect(animeResumeEpisode(media, 18)).toBe(19)
    expect(animeResumeEpisode(media, 19)).toBe(19)
    expect(airedCount(normalizeAnimeDetail({ ...base, videos: [{ number: 24 }] }))).toBe(Infinity)
  })

  it('preserves published source numbers, including gaps and fractional specials, for resume and playback', () => {
    const media = normalizeAnimeDetail({ ...base, catalog: { ...ref, provider: 'jvm' }, videos: [
      { number: 14, id: '/episode-14' }, { number: 12.5, id: '/special' }, { number: 12, id: '/episode-12' },
    ] })
    expect(animeEpisodeNumbers(media)).toEqual([12, 12.5, 14])
    expect(airedCount(media)).toBe(14)
    expect(animeResumeEpisode(media, 12)).toBe(12.5)
    expect(animeResumeEpisode(media, 12.5)).toBe(14)
  })

  it('keeps native episode titles, dates, summaries and thumbnails', () => {
    expect(animeEpisodeMetadata({ ...base, videos: [{
      number: 20, title: 'A new chapter', thumbnail: '/episode-20.jpg', overview: 'Episode summary', released: '2026-09-05',
    }] })[20]).toEqual({
      title: 'A new chapter', image: '/episode-20.jpg', overview: 'Episode summary', airDate: '2026-09-05', season: undefined,
    })
  })

  it('retains ordinary AniList episode numbering and resume behavior', () => {
    const media: Media = { id: 171110, title: base.title, episodes: 24, nextAiringEpisode: { episode: 20, airingAt: 0, timeUntilAiring: 0 } }
    expect(animeEpisodeNumbers(media)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1))
    expect(animeResumeEpisode(media, 18)).toBe(19)
  })

  it('reads progress across a mapped title while respecting an explicit reset to zero', () => {
    const media = { ...base, externalIds: { anilist: 171110 }, mediaListEntry: { progress: 3 } }
    const history = { [media.id]: { progress: 4 }, 171110: { progress: 19 } }
    expect(animeWatchedProgress(media, history, {}, {})).toBe(19)
    expect(animeWatchedProgress(media, history, { [media.id]: 20 }, {})).toBe(20)
    expect(animeWatchedProgress(media, history, {}, { 171110: 0 })).toBe(0)
    expect(animeWatchedProgress(media, history, {}, { [media.id]: 0 })).toBe(0)
    expect(animeWatchedProgress(base, history, {}, {})).toBe(4)
  })
})
