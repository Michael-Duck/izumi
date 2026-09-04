import type { Airing } from '$lib/anilist/schedule'
import { mediaRef } from '$lib/catalog/identity'
import { releaseMoment } from '$lib/schedule/personal'
import { mapTraktMedia, type TraktRawMedia } from './catalog'
import { traktFetch } from './client'

export type TraktCalendarFeed = 'for-you' | 'streaming' | 'premieres' | 'finales' | 'hot'

interface TraktCalendarEpisode {
  title?: string | null
  season?: number
  number?: number
  episode_type?: string | null
  episodes?: Array<{ season?: number; number?: number }> | null
}

export interface TraktCalendarRow {
  released?: string | null
  movie?: TraktRawMedia | null
  first_aired?: string | null
  episode?: TraktCalendarEpisode | null
  show?: TraktRawMedia | null
}

function localDate(unix: number): string {
  const date = new Date(unix * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function endpoint(feed: TraktCalendarFeed, start: number, days: number): string {
  const range = `${localDate(start)}/${days}`
  const base = feed === 'for-you'
    ? `/calendars/my/media/${range}`
    : feed === 'streaming'
      ? `/calendars/all/streaming/${range}`
      : feed === 'premieres'
        ? `/calendars/all/shows/premieres/${range}`
        : feed === 'finales'
          ? `/calendars/all/shows/finales/${range}`
          : `/calendars/releases/hot/${range}`
  const grouped = feed === 'for-you' || feed === 'hot' ? '&group=day' : ''
  return `${base}?extended=full,images${grouped}`
}

function episodeLabel(episode: TraktCalendarEpisode, feed: TraktCalendarFeed): string {
  const labels: Record<string, string> = {
    series_premiere: 'Series premiere',
    season_premiere: 'Season premiere',
    mid_season_premiere: 'Mid-season premiere',
    season_finale: 'Season finale',
    series_finale: 'Series finale',
    mid_season_finale: 'Mid-season finale',
    full_season: 'Full-season drop',
    multiple_episodes: 'Multiple episodes',
  }
  return labels[episode.episode_type ?? '']
    ?? (feed === 'premieres' ? 'Season premiere' : feed === 'finales' ? 'Finale' : '')
}

function movieLabel(feed: TraktCalendarFeed): string {
  if (feed === 'streaming') return 'Streaming release'
  if (feed === 'hot') return 'Movie release'
  return 'Movie premiere'
}

function contextFor(feed: TraktCalendarFeed, episode?: TraktCalendarEpisode | null): string | undefined {
  const episodeTitle = episode?.title?.trim()
  const grouped = episode?.episodes?.length && episode.episodes.length > 1
    ? `${episode.episodes.length} episodes`
    : ''
  const feedContext = feed === 'for-you'
    ? 'In your Trakt calendar'
    : feed === 'hot'
      ? 'Popular on Trakt'
      : ''
  return [episodeTitle, grouped, feedContext].filter(Boolean).join(' · ') || undefined
}

/** Convert Trakt's mixed calendar rows into Izumi's provider-neutral schedule cards. */
export function mapTraktCalendarRows(
  rows: TraktCalendarRow[],
  feed: TraktCalendarFeed,
  start: number,
  end: number,
): Airing[] {
  return rows.flatMap<Airing>((row): Airing[] => {
    if (row.movie) {
      const mapped = mapTraktMedia(row.movie, 'movie')
      const moment = releaseMoment(row.released ?? undefined)
      if (!mapped || !moment || moment.airingAt < start || moment.airingAt >= end) return []
      return [{
        ...moment,
        episode: 1,
        kind: 'movie' as const,
        source: 'trakt' as const,
        media: mapped.media,
        eventLabel: movieLabel(feed),
        context: contextFor(feed),
      }]
    }

    if (row.show && row.episode) {
      const mapped = mapTraktMedia(row.show, 'show')
      const moment = releaseMoment(row.first_aired ?? undefined)
      if (!mapped || !moment || moment.airingAt < start || moment.airingAt >= end) return []
      const number = row.episode.number ?? 1
      return [{
        ...moment,
        episode: number,
        season: row.episode.season,
        providerEpisode: number,
        kind: 'episode' as const,
        source: 'trakt' as const,
        media: mapped.media,
        eventLabel: episodeLabel(row.episode, feed) || undefined,
        context: contextFor(feed, row.episode),
      }]
    }
    return []
  }).sort((left, right) => left.airingAt - right.airingAt)
}

function dayIdentity(unix: number): string {
  const date = new Date(unix * 1000)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** Prefer Trakt's richer record when the local provider found the same release. */
export function mergeCalendarAirings(primary: Airing[], fallback: Airing[]): Airing[] {
  const seen = new Set<string>()
  return [...primary, ...fallback]
    .filter((item) => {
      const ref = mediaRef(item.media)
      const key = [ref.type, ref.id, item.kind, item.season, item.providerEpisode ?? item.episode, dayIdentity(item.airingAt)].join(':')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => left.airingAt - right.airingAt)
}

export async function loadTraktCalendar(
  feed: TraktCalendarFeed,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Airing[]> {
  const days = Math.max(1, Math.ceil((end - start) / 86_400))
  const response = await traktFetch(endpoint(feed, start, days), { signal })
  if (!response) throw new Error('Connect Trakt in Accounts to unlock the expanded release calendar.')
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; error_description?: string }
    throw new Error(body.error_description || body.error || `Trakt calendar failed (${response.status}).`)
  }
  const rows = await response.json() as TraktCalendarRow[]
  return mapTraktCalendarRows(rows, feed, start, end)
}
