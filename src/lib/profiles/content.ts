import { derived, type Readable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { activeProfile, type IzumiProfile } from './store'

const ratingPatterns: Array<[RegExp, number]> = [
  [/\b(?:nc-?17|tv-ma|18\+?|r18|rx|adult)\b/i, 18],
  [/\b(?:r\+?|tv-?17|17\+?|16\+?|16)\b/i, 16],
  [/\b(?:pg-?13|tv-14|15|14\+?|12a?|r\s*-\s*17\+)\b/i, 12],
  [/\b(?:pg|tv-pg|tv-y7|7\+?)\b/i, 7],
  [/\b(?:g|u|tv-g|tv-y)\b/i, 0],
]

export function contentRatingAge(value?: string): number | undefined {
  if (!value) return undefined
  for (const [pattern, age] of ratingPatterns) if (pattern.test(value)) return age
  return undefined
}

export function profileAllowsAdult(profile: IzumiProfile): boolean {
  return profile.ratingLimit === 18 && profile.allowAdult
}

export function profileAllowsMedia(media: Pick<Media, 'isAdult' | 'contentRating'>, profile: IzumiProfile): boolean {
  if (media.isAdult && !profileAllowsAdult(profile)) return false
  const age = contentRatingAge(media.contentRating)
  return age == null || age <= profile.ratingLimit
}

export const activeProfileAllowsAdult: Readable<boolean> = derived(activeProfile, profileAllowsAdult)

