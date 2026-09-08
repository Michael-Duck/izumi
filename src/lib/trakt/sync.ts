import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { externalIdsOf, mediaKey } from '$lib/catalog/identity'
import { anilistIdOf } from '$lib/catalog/identity'
import { getExtensionIds } from '$lib/anizip'
import { incognito } from '$lib/stores/incognito'
import {
  traktHistoryDedupe,
  traktSyncQueue,
  traktToken,
} from './config'
import { traktFetch } from './client'
import type { TraktBulkMediaBody, TraktMediaIds, TraktQueuedAction } from './types'

const HISTORY_DEDUPE_MS = 10 * 60_000
let flushing: Promise<void> | null = null

function isMovie(media: Media): boolean {
  return media.type === 'MOVIE' || media.format === 'MOVIE' || media.catalog?.type === 'movie'
}

function compactIds(ids: TraktMediaIds): TraktMediaIds {
  return Object.fromEntries(Object.entries(ids).filter(([, value]) => value != null && value !== '')) as TraktMediaIds
}

export function buildTraktMediaBody(
  media: Media,
  episode?: number,
  resolved: { tmdbId?: string; imdbId?: string; tvdbId?: number; tvdbEId?: number; season?: number; episodeNumber?: number } = {},
): TraktBulkMediaBody | null {
  const external = externalIdsOf(media)
  if (!isMovie(media) && resolved.tvdbEId) return { episodes: [{ ids: { tvdb: resolved.tvdbEId } }] }
  const ids = compactIds({
    imdb: external.imdb ?? resolved.imdbId,
    tmdb: external.tmdb ?? (resolved.tmdbId ? Number(resolved.tmdbId) || undefined : undefined),
    tvdb: isMovie(media) ? undefined : external.tvdb ?? resolved.tvdbId,
  })
  if (!Object.keys(ids).length) return null
  if (isMovie(media)) return { movies: [{ ids }] }
  if (episode == null) return { shows: [{ ids }] }
  const video = media.videos?.find((item) => item.number === episode)
  const season = resolved.season ?? video?.season ?? media.seasonNumber ?? 1
  const episodeNumber = resolved.episodeNumber ?? video?.episode ?? episode
  return { shows: [{ ids, seasons: [{ number: season, episodes: [{ number: episodeNumber }] }] }] }
}

async function mediaBody(media: Media, episode?: number): Promise<TraktBulkMediaBody | null> {
  const ids = externalIdsOf(media)
  const anilistId = anilistIdOf(media)
  // AniZip's episode-level TVDB mapping avoids treating absolute anime episode numbers as
  // season-local numbers for long-running shows, even when the title already has a TMDB id.
  if (anilistId && episode != null && !isMovie(media)) {
    try { return buildTraktMediaBody(media, episode, await getExtensionIds(anilistId, episode)) }
    catch { /* fall through to title-level ids */ }
  }
  if (ids.imdb || ids.tmdb || ids.tvdb) return buildTraktMediaBody(media, episode)
  if (!anilistId) return null
  try { return buildTraktMediaBody(media, episode, await getExtensionIds(anilistId, episode)) }
  catch { return null }
}

function enqueue(action: TraktQueuedAction) {
  traktSyncQueue.update((queue) => queue.some((item) => item.id === action.id) ? queue : [...queue, action].slice(-200))
}

function retryable(status: number): boolean {
  return status === 401 || status === 408 || status === 425 || status === 429 || status >= 500
}

export function flushTraktSyncQueue(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    if (!get(traktToken) || get(incognito)) return
    for (const action of get(traktSyncQueue)) {
      let response: Response | null
      try {
        response = await traktFetch(action.path, { method: 'POST', body: JSON.stringify(action.body) })
      } catch { return }
      if (!response) return
      if (!response.ok && retryable(response.status)) return
      // Successful requests and permanently invalid payloads must not poison the queue forever.
      traktSyncQueue.update((queue) => queue.filter((item) => item.id !== action.id))
    }
  })().finally(() => { flushing = null })
  return flushing
}

async function queueMediaAction(
  media: Media,
  path: TraktQueuedAction['path'],
  actionId: string,
  transform: (body: TraktBulkMediaBody) => object = (body) => body,
  episode?: number,
): Promise<boolean> {
  if (!get(traktToken) || get(incognito)) return false
  const body = await mediaBody(media, episode)
  if (!body) return false
  enqueue({ id: actionId, path, body: transform(body), createdAt: Date.now() })
  await flushTraktSyncQueue()
  return !get(traktSyncQueue).some((action) => action.id === actionId)
}

export async function addTraktHistory(media: Media, episode: number, watchedAt?: number): Promise<boolean> {
  const key = `${mediaKey(media)}:${episode}`
  const now = Date.now()
  const recent = get(traktHistoryDedupe)[key] ?? 0
  if (now - recent < HISTORY_DEDUPE_MS) return true
  const sent = await queueMediaAction(media, '/sync/history', `history:${key}`, (body) => {
    if (watchedAt == null) return body
    const watched_at = new Date(watchedAt).toISOString()
    return {
      ...body,
      ...(body.movies ? { movies: body.movies.map(item => ({ ...item, watched_at })) } : {}),
      ...(body.episodes ? { episodes: body.episodes.map(item => ({ ...item, watched_at })) } : {}),
      ...(body.shows ? { shows: body.shows.map(show => ({ ...show,
        seasons: show.seasons?.map(season => ({ ...season, episodes: season.episodes.map(item => ({ ...item, watched_at })) })),
      })) } : {}),
    }
  }, episode)
  if (sent) {
    traktHistoryDedupe.update((state) => {
      const fresh = Object.fromEntries(Object.entries(state).filter(([, timestamp]) => now - timestamp < HISTORY_DEDUPE_MS))
      return { ...fresh, [key]: now }
    })
  }
  return sent
}

export function setTraktWatchlist(media: Media, enabled: boolean): Promise<boolean> {
  return queueMediaAction(
    media,
    enabled ? '/sync/watchlist' : '/sync/watchlist/remove',
    `watchlist:${mediaKey(media)}:${enabled ? 'add' : 'remove'}`,
  )
}

export function setTraktRating(media: Media, score0to100: number): Promise<boolean> {
  const rating = Math.max(0, Math.min(10, Math.round(score0to100 / 10)))
  return queueMediaAction(
    media,
    rating ? '/sync/ratings' : '/sync/ratings/remove',
    `rating:${mediaKey(media)}:${rating}`,
    rating
      ? (body) => Object.fromEntries(Object.entries(body).map(([key, values]) => [
          key,
          (values as Array<Record<string, unknown>>).map((value) => ({ ...value, rating })),
        ]))
      : (body) => body,
  )
}

if (typeof window !== 'undefined') queueMicrotask(() => { void flushTraktSyncQueue() })
