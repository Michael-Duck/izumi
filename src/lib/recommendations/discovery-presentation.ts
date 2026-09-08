import type { Media } from '$lib/anilist/types'
import { format } from '$lib/anilist/media'
import { playbackLanguageName } from '$lib/shared/languages'

export function discoveryKind(media: Media): string {
  if (media.catalog?.type === 'movie' || media.type === 'MOVIE' || media.format === 'MOVIE') return 'Movie'
  if (media.catalog?.type === 'series' || media.type === 'SERIES') return 'Series'
  if (media.format === 'TV' || media.format === 'TV_SHORT') return 'Anime series'
  return format(media) || (media.type === 'ANIME' || media.catalog?.type === 'anime' ? 'Anime' : '')
}

/** Only supplied facts: no invented seasons, ratings, or running times. */
export function discoveryFacts(media: Media, compact = false): string[] {
  const year = media.startDate?.year || media.seasonYear
  const facts = [discoveryKind(media), year ? String(year) : ''].filter(Boolean)
  if (compact) return facts
  const movie = discoveryKind(media) === 'Movie'
  if (!movie && media.episodes && media.episodes > 0) facts.push(`${media.episodes} episode${media.episodes === 1 ? '' : 's'}`)
  if (media.duration && media.duration > 0) {
    const minutes = Math.round(media.duration)
    facts.push(movie
      ? [minutes >= 60 ? `${Math.floor(minutes / 60)}h` : '', minutes % 60 ? `${minutes % 60}m` : ''].filter(Boolean).join(' ')
      : `${minutes} min / ep`)
  }
  if (media.contentRating) facts.push(media.contentRating)
  if (media.originalLanguage) facts.push(playbackLanguageName(media.originalLanguage))
  return facts
}

export function discoveryTrailerId(media?: Media): string | undefined {
  const trailer = media?.trailer
  return trailer?.id && (!trailer.site || trailer.site.toLowerCase() === 'youtube')
    && /^[a-zA-Z0-9_-]{11}$/.test(trailer.id) ? trailer.id : undefined
}

export const DISCOVERY_PAGE_SIZE = 5

export function discoveryWindow<T>(items: T[], currentIndex: number) {
  const start = Math.floor(Math.max(0, currentIndex) / DISCOVERY_PAGE_SIZE) * DISCOVERY_PAGE_SIZE
  return { start, items: items.slice(start, start + DISCOVERY_PAGE_SIZE) }
}
