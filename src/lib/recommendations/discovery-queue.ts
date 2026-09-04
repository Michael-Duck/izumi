import type { Media } from '$lib/anilist/types'
import { mediaKey } from '$lib/catalog/identity'
import type { LocalLibraryState } from '$lib/library/local-lists'
import type { HistoryEntry } from '$lib/player/history'
import { profiledPersisted } from '$lib/profiles/store'

const DAY = 86_400_000
const MAX_RECORDS = 500

export type DiscoveryQueueAction = 'skip' | 'dismiss' | 'save'

interface DiscoveryTasteMedia {
  id: number
  catalog?: Media['catalog']
  type?: Media['type']
  format?: string
  title: Media['title']
  genres?: string[]
  originalLanguage?: string
}

export interface DiscoveryQueueDecision {
  action: DiscoveryQueueAction
  at: number
  until?: number
  media: DiscoveryTasteMedia
}

export interface DiscoveryQueueFeedbackState {
  records: Record<string, DiscoveryQueueDecision>
}

export interface DiscoveryTasteSeed {
  media: DiscoveryTasteMedia
  weight: number
}

export interface DiscoveryQueueItem {
  media: Media
  score: number
  reason: string
}

export const discoveryQueueFeedback = profiledPersisted<DiscoveryQueueFeedbackState>(
  'discovery-queue-feedback-v1',
  { records: {} },
)

function tasteSnapshot(media: Media): DiscoveryTasteMedia {
  return {
    id: media.id,
    catalog: media.catalog,
    type: media.type,
    format: media.format,
    title: media.title,
    genres: media.genres?.slice(0, 12),
    originalLanguage: media.originalLanguage,
  }
}

export function recordDiscoveryDecision(
  media: Media,
  action: DiscoveryQueueAction,
  now = Date.now(),
): void {
  discoveryQueueFeedback.update((state) => {
    const records = { ...(state?.records ?? {}) }
    records[mediaKey(media)] = {
      action,
      at: now,
      until: action === 'skip' ? now + 7 * DAY : undefined,
      media: tasteSnapshot(media),
    }
    const trimmed = Object.fromEntries(Object.entries(records)
      .sort(([, left], [, right]) => right.at - left.at)
      .slice(0, MAX_RECORDS))
    return { records: trimmed }
  })
}

export function forgetDiscoveryDecision(media: Media): void {
  discoveryQueueFeedback.update((state) => {
    const records = { ...(state?.records ?? {}) }
    delete records[mediaKey(media)]
    return { records }
  })
}

export function discoveryDecisionHides(
  decision: DiscoveryQueueDecision | undefined,
  now = Date.now(),
): boolean {
  if (!decision) return false
  if (decision.action === 'skip') return (decision.until ?? decision.at + 7 * DAY) > now
  return true
}

export function libraryTasteSeeds(state: LocalLibraryState): DiscoveryTasteSeed[] {
  return Object.values(state.entries ?? {}).flatMap((entry) => {
    const status = entry.tracking?.status
    const score = entry.tracking?.score
    let weight = entry.listIds.length ? 0.65 : 0.35
    if (status === 'CURRENT') weight += 0.35
    else if (status === 'COMPLETED') weight += 0.55
    else if (status === 'REPEATING') weight += 0.8
    else if (status === 'DROPPED') weight -= 1.15
    if (score != null && score > 0) weight += (score - 60) / 45
    return Math.abs(weight) < 0.05 ? [] : [{ media: tasteSnapshot(entry.media), weight }]
  })
}

export function historyTasteSeeds(history: Record<number, HistoryEntry>, now = Date.now()): DiscoveryTasteSeed[] {
  return Object.values(history).map((entry) => {
    const ageDays = Math.max(0, now - entry.updatedAt) / DAY
    const recency = Math.exp(-ageDays / 180)
    const total = Math.max(1, entry.media.episodes ?? entry.progress ?? 1)
    const completion = Math.min(1, Math.max(entry.progress, entry.episode * 0.35) / total)
    return { media: tasteSnapshot(entry.media), weight: 0.35 + recency * 0.3 + completion * 0.35 }
  })
}

export function feedbackTasteSeeds(state: DiscoveryQueueFeedbackState): DiscoveryTasteSeed[] {
  return Object.values(state?.records ?? {}).flatMap((record) => {
    if (record.action === 'skip') return []
    return [{ media: record.media, weight: record.action === 'save' ? 1.1 : -0.85 }]
  })
}

interface RankOptions {
  excludedKeys?: Iterable<string>
  now?: number
  limit?: number
}

/**
 * Small, local affinity ranker used by the Discovery Queue. It learns only broad genres,
 * languages and formats, so every reason shown to the viewer is truthful and understandable.
 * A future collaborative service can replace the candidate score without changing queue actions.
 */
export function rankDiscoveryQueue(
  candidates: Media[],
  seeds: DiscoveryTasteSeed[],
  feedback: DiscoveryQueueFeedbackState,
  options: RankOptions = {},
): DiscoveryQueueItem[] {
  const now = options.now ?? Date.now()
  const excluded = new Set(options.excludedKeys ?? [])
  const unique = new Map<string, Media>()
  for (const media of candidates) {
    const key = mediaKey(media)
    if (!excluded.has(key) && !discoveryDecisionHides(feedback?.records?.[key], now)) unique.set(key, media)
  }

  const genres = affinityMap(seeds.flatMap((seed) => (seed.media.genres ?? []).map((genre) => [genre, seed.weight] as const)))
  const languages = affinityMap(seeds.flatMap((seed) => seed.media.originalLanguage
    ? [[seed.media.originalLanguage, seed.weight] as const] : []))
  const formats = affinityMap(seeds.map((seed) => [seed.media.type ?? seed.media.format ?? '', seed.weight] as const))
  const hasPositiveTaste = [...genres.values(), ...languages.values(), ...formats.values()].some((value) => value > 0)
  const day = Math.floor(now / DAY)

  const scored = [...unique.values()].map((media): DiscoveryQueueItem => {
    const matchingGenres = (media.genres ?? [])
      .map((genre) => ({ genre, affinity: genres.get(genre) ?? 0 }))
      .filter((match) => match.affinity > 0)
      .sort((left, right) => right.affinity - left.affinity)
    const genreAffinity = matchingGenres.slice(0, 3).reduce((sum, match) => sum + match.affinity, 0)
    const languageAffinity = languages.get(media.originalLanguage ?? '') ?? 0
    const formatAffinity = formats.get(media.type ?? media.format ?? '') ?? 0
    const quality = Math.max(0, Math.min(1, (media.averageScore ?? 65) / 100))
    const popularity = Math.log1p(Math.max(0, media.popularity ?? 0)) / 12
    const dailyVariance = stableFraction(`${day}:${mediaKey(media)}`) * 0.16
    const score = genreAffinity * 1.55 + languageAffinity * 0.55 + formatAffinity * 0.18
      + quality * 0.72 + popularity * 0.32 + dailyVariance
    const reason = matchingGenres.length
      ? `Matches your ${matchingGenres.slice(0, 2).map((match) => match.genre).join(' + ')} taste`
      : languageAffinity > 0 && media.originalLanguage
        ? `More from your ${languageName(media.originalLanguage)} picks`
        : hasPositiveTaste
          ? 'A fresh turn from your usual picks'
          : (media.averageScore ?? 0) >= 75
            ? 'Acclaimed and popular on TMDB'
            : 'Popular this week on TMDB'
    return { media, score, reason }
  }).sort((left, right) => right.score - left.score || mediaKey(left.media).localeCompare(mediaKey(right.media)))

  // Greedy diversity keeps one dominant genre from swallowing the deck while retaining relevance.
  const result: DiscoveryQueueItem[] = []
  const remaining = [...scored]
  const genreUses = new Map<string, number>()
  while (remaining.length && result.length < (options.limit ?? 60)) {
    let bestIndex = 0
    let bestScore = Number.NEGATIVE_INFINITY
    for (let index = 0; index < remaining.length; index++) {
      const item = remaining[index]
      const repetition = (item.media.genres ?? []).slice(0, 3)
        .reduce((sum, genre) => sum + (genreUses.get(genre) ?? 0), 0) * 0.13
      if (item.score - repetition > bestScore) {
        bestScore = item.score - repetition
        bestIndex = index
      }
    }
    const [picked] = remaining.splice(bestIndex, 1)
    result.push(picked)
    for (const genre of (picked.media.genres ?? []).slice(0, 3)) genreUses.set(genre, (genreUses.get(genre) ?? 0) + 1)
  }
  return result
}

function affinityMap(entries: ReadonlyArray<readonly [string, number]>): Map<string, number> {
  const result = new Map<string, number>()
  for (const [key, weight] of entries) if (key) result.set(key, (result.get(key) ?? 0) + weight)
  return result
}

function stableFraction(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  return (hash >>> 0) / 0xffffffff
}

function languageName(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code.toUpperCase() }
  catch { return code.toUpperCase() }
}
