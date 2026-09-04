import type { Media } from '$lib/anilist/types'
import { compatibilityMediaId } from '$lib/catalog/identity'
import { profileAllowsMedia } from '$lib/profiles/content'
import { activeProfile } from '$lib/profiles/store'
import { get } from 'svelte/store'
import { traktFetch } from './client'

export type TraktMediaKind = 'movie' | 'show'

export interface TraktRawMedia {
  title?: string
  year?: number | null
  ids?: { trakt?: number; imdb?: string | null; tmdb?: number | null; tvdb?: number | null }
  images?: {
    fanart?: string[]
    poster?: string[]
    logo?: string[]
    thumb?: string[]
  } | null
  overview?: string | null
  tagline?: string | null
  released?: string | null
  first_aired?: string | null
  runtime?: number | null
  country?: string | null
  status?: string | null
  rating?: number | null
  votes?: number | null
  language?: string | null
  genres?: string[] | null
  certification?: string | null
  network?: string | null
  aired_episodes?: number | null
}

interface TraktWrappedMedia {
  type?: string
  listed_at?: string
  watched_at?: string
  movie?: TraktRawMedia
  show?: TraktRawMedia
  episode?: { season?: number; number?: number; title?: string }
}

export interface TraktHubItem {
  media: Media
  traktId: number
  kind: TraktMediaKind
  timestamp?: string
  context?: string
}

export type TraktHubSection = 'movieRecommendations' | 'showRecommendations' | 'watchlist' | 'history'

export interface TraktHubData {
  movieRecommendations: TraktHubItem[]
  showRecommendations: TraktHubItem[]
  watchlist: TraktHubItem[]
  history: TraktHubItem[]
  errors: Partial<Record<TraktHubSection, string>>
}

function normalizedStatus(value?: string | null): string | undefined {
  const status = value?.toLowerCase()
  if (!status) return undefined
  if (status.includes('return') || status.includes('production') || status.includes('continu')) return 'RELEASING'
  if (status.includes('plan') || status.includes('upcoming')) return 'NOT_YET_RELEASED'
  if (status.includes('cancel')) return 'CANCELLED'
  if (status.includes('end') || status.includes('release')) return 'FINISHED'
  return undefined
}

function firstImage(values?: string[]): string | undefined {
  return values?.find((value) => /^https:\/\//i.test(value))
}

export function mapTraktMedia(raw: TraktRawMedia, kind: TraktMediaKind): TraktHubItem | null {
  const tmdb = raw.ids?.tmdb
  const traktId = raw.ids?.trakt
  if (!raw.title || !tmdb || !traktId) return null
  const ref = { provider: 'tmdb' as const, type: kind === 'movie' ? 'movie' as const : 'series' as const, id: String(tmdb) }
  const releaseDate = kind === 'movie' ? raw.released : raw.first_aired
  const media: Media = {
    id: compatibilityMediaId(ref),
    catalog: ref,
    externalIds: {
      tmdb,
      imdb: raw.ids?.imdb ?? undefined,
      tvdb: raw.ids?.tvdb ?? undefined,
    },
    type: kind === 'movie' ? 'MOVIE' : 'SERIES',
    format: kind === 'movie' ? 'MOVIE' : 'TV',
    title: { english: raw.title, romaji: raw.title, userPreferred: raw.title },
    description: raw.overview ?? undefined,
    tagline: raw.tagline ?? undefined,
    releaseDate: releaseDate ?? undefined,
    startDate: raw.year ? { year: raw.year } : undefined,
    duration: raw.runtime ?? undefined,
    countryOfOrigin: raw.country?.toUpperCase(),
    originalLanguage: raw.language ?? undefined,
    status: normalizedStatus(raw.status),
    episodes: kind === 'movie' ? 1 : undefined,
    airedEpisodes: raw.aired_episodes ?? undefined,
    averageScore: raw.rating != null ? Math.round(raw.rating * 10) : undefined,
    ratings: raw.rating != null && raw.rating > 0
      ? [{ source: 'Trakt', score: raw.rating, scale: 10, votes: raw.votes ?? undefined }]
      : undefined,
    genres: raw.genres ?? undefined,
    contentRating: raw.certification ?? undefined,
    studios: raw.network ? { nodes: [{ name: raw.network }] } : undefined,
    coverImage: {
      extraLarge: firstImage(raw.images?.poster),
      large: firstImage(raw.images?.poster),
      medium: firstImage(raw.images?.poster),
    },
    bannerImage: firstImage(raw.images?.fanart) ?? firstImage(raw.images?.thumb),
    logoImage: firstImage(raw.images?.logo),
  }
  return profileAllowsMedia(media, get(activeProfile)) ? { media, traktId, kind } : null
}

async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await traktFetch(path, { signal })
  if (!response) throw new Error('Connect Trakt in Accounts to use this page.')
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; error_description?: string }
    throw new Error(body.error_description || body.error || `Trakt request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

const query = (limit: number, paginated = true) =>
  `extended=full,images&limit=${limit}${paginated ? '&page=1' : ''}`

async function recommendations(kind: TraktMediaKind, signal?: AbortSignal): Promise<TraktHubItem[]> {
  const plural = kind === 'movie' ? 'movies' : 'shows'
  const rows = await json<TraktRawMedia[]>(`/recommendations/${plural}?${query(20, false)}&ignore_watchlisted=true`, signal)
  return rows.flatMap((row) => mapTraktMedia(row, kind) ?? [])
}

async function watchlist(kind: TraktMediaKind, signal?: AbortSignal): Promise<TraktHubItem[]> {
  const plural = kind === 'movie' ? 'movies' : 'shows'
  const rows = await json<TraktWrappedMedia[]>(`/sync/watchlist/${plural}/added/desc?${query(20)}`, signal)
  return rows.flatMap((row) => {
    const mapped = mapTraktMedia(kind === 'movie' ? row.movie ?? {} : row.show ?? {}, kind)
    return mapped ? [{ ...mapped, timestamp: row.listed_at }] : []
  })
}

async function history(kind: TraktMediaKind, signal?: AbortSignal): Promise<TraktHubItem[]> {
  const type = kind === 'movie' ? 'movies' : 'episodes'
  const rows = await json<TraktWrappedMedia[]>(`/sync/history/${type}?${query(30)}`, signal)
  return rows.flatMap((row) => {
    const mapped = mapTraktMedia(kind === 'movie' ? row.movie ?? {} : row.show ?? {}, kind)
    if (!mapped) return []
    const episode = row.episode
    const context = episode?.season != null && episode.number != null
      ? `S${episode.season} E${episode.number}${episode.title ? ` · ${episode.title}` : ''}`
      : undefined
    return [{ ...mapped, timestamp: row.watched_at, context }]
  })
}

function uniqueRecent(items: TraktHubItem[]): TraktHubItem[] {
  const seen = new Set<string>()
  return items
    .sort((left, right) => Date.parse(right.timestamp ?? '') - Date.parse(left.timestamp ?? ''))
    .filter((item) => {
      const key = `${item.kind}:${item.traktId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export async function loadTraktHub(signal?: AbortSignal): Promise<TraktHubData> {
  const tasks = {
    movieRecommendations: recommendations('movie', signal),
    showRecommendations: recommendations('show', signal),
    watchlistMovies: watchlist('movie', signal),
    watchlistShows: watchlist('show', signal),
    historyMovies: history('movie', signal),
    historyShows: history('show', signal),
  }
  const keys = Object.keys(tasks) as Array<keyof typeof tasks>
  const settled = await Promise.allSettled(keys.map((key) => tasks[key]))
  const values = new Map(keys.map((key, index) => [key, settled[index]]))
  const rows = (key: keyof typeof tasks) => {
    const result = values.get(key)
    return result?.status === 'fulfilled' ? result.value : []
  }
  const message = (keysForSection: Array<keyof typeof tasks>) => {
    const failure = keysForSection.map((key) => values.get(key)).find((result) => result?.status === 'rejected')
    if (failure?.status !== 'rejected') return undefined
    return failure.reason instanceof Error ? failure.reason.message : String(failure.reason)
  }
  return {
    movieRecommendations: rows('movieRecommendations'),
    showRecommendations: rows('showRecommendations'),
    watchlist: uniqueRecent([...rows('watchlistMovies'), ...rows('watchlistShows')]),
    history: uniqueRecent([...rows('historyMovies'), ...rows('historyShows')]),
    errors: {
      movieRecommendations: message(['movieRecommendations']),
      showRecommendations: message(['showRecommendations']),
      watchlist: message(['watchlistMovies', 'watchlistShows']),
      history: message(['historyMovies', 'historyShows']),
    },
  }
}

export async function hideTraktRecommendation(item: TraktHubItem): Promise<void> {
  const plural = item.kind === 'movie' ? 'movies' : 'shows'
  const response = await traktFetch(`/recommendations/${plural}/${item.traktId}`, { method: 'DELETE' })
  if (!response?.ok) throw new Error(`Trakt could not hide this recommendation${response ? ` (${response.status})` : ''}.`)
}
