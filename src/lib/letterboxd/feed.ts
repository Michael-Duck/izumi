import { get } from 'svelte/store'
import { trackerHttpFetch } from '$lib/trackers/tracker-http'
import { activeProfile } from '$lib/profiles/store'
import { profileAllowsMedia } from '$lib/profiles/content'
import { compatibilityMediaId } from '$lib/catalog/identity'
import type { Media } from '$lib/anilist/types'
import { letterboxdFeedCache, letterboxdFeedUpdatedAt } from './config'
import type { LetterboxdFeedEntry } from './types'

const USERNAME = /^[A-Za-z0-9_]{2,15}$/

export function validLetterboxdUsername(value: string): boolean {
  return USERNAME.test(value.trim())
}

export function letterboxdFeedUrl(username: string): string {
  if (!validLetterboxdUsername(username)) throw new Error('Enter a valid Letterboxd username (2–15 letters, numbers, or underscores).')
  return `https://letterboxd.com/${username.trim()}/rss/`
}

function text(item: Element, name: string): string {
  return item.getElementsByTagName(name)[0]?.textContent?.trim() ?? ''
}

function descriptionParts(markup: string): { cover?: string; review?: string } {
  const html = new DOMParser().parseFromString(markup, 'text/html')
  const cover = html.querySelector('img')?.getAttribute('src') ?? undefined
  html.querySelector('img')?.closest('p')?.remove()
  const review = html.body.textContent?.replace(/\s+/g, ' ').trim()
  return { cover: cover?.startsWith('https://') ? cover : undefined, review: review || undefined }
}

export function parseLetterboxdFeed(xml: string): LetterboxdFeedEntry[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('Letterboxd returned an invalid RSS feed.')
  const profile = get(activeProfile)
  return [...document.querySelectorAll('item')].flatMap((item) => {
    const title = text(item, 'letterboxd:filmTitle')
    const tmdb = Number(text(item, 'tmdb:movieId'))
    const uri = text(item, 'link')
    if (!title || !Number.isInteger(tmdb) || tmdb <= 0 || !uri.startsWith('https://letterboxd.com/')) return []
    const year = Number(text(item, 'letterboxd:filmYear')) || undefined
    const rating = Number(text(item, 'letterboxd:memberRating')) || undefined
    const { cover, review } = descriptionParts(text(item, 'description'))
    const ref = { provider: 'tmdb' as const, type: 'movie' as const, id: String(tmdb) }
    const media: Media = {
      id: compatibilityMediaId(ref),
      catalog: ref,
      externalIds: { tmdb },
      type: 'MOVIE' as const,
      format: 'MOVIE',
      episodes: 1,
      title: { english: title, romaji: title, userPreferred: title },
      startDate: year ? { year } : undefined,
      averageScore: rating ? Math.round(rating * 20) : undefined,
      ratings: rating ? [{ source: 'Letterboxd', score: rating, scale: 5 as const }] : undefined,
      coverImage: cover ? { extraLarge: cover, large: cover, medium: cover } : undefined,
    }
    if (!profileAllowsMedia(media, profile)) return []
    return [{
      key: text(item, 'guid') || uri,
      media,
      uri,
      watchedDate: text(item, 'letterboxd:watchedDate') || undefined,
      publishedAt: text(item, 'pubDate') || undefined,
      rating,
      liked: text(item, 'letterboxd:memberLike').toLowerCase() === 'yes',
      rewatch: text(item, 'letterboxd:rewatch').toLowerCase() === 'yes',
      review,
    } satisfies LetterboxdFeedEntry]
  })
}

export async function fetchLetterboxdFeed(username: string, signal?: AbortSignal): Promise<LetterboxdFeedEntry[]> {
  const response = await trackerHttpFetch(letterboxdFeedUrl(username), { signal }, 'Letterboxd')
  if (response.status === 404) throw new Error('That Letterboxd profile or RSS feed was not found.')
  if (!response.ok) throw new Error(`Letterboxd feed request failed (${response.status}).`)
  const entries = parseLetterboxdFeed(await response.text())
  letterboxdFeedCache.set(entries)
  letterboxdFeedUpdatedAt.set(Date.now())
  return entries
}
