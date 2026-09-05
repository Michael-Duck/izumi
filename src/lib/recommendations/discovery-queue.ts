import type { Media } from '$lib/anilist/types'
import { rankRecommendations, type TasteItem } from '$lib/shared/recommendation-engine'
import { normalizeLang } from '$lib/stremio/sublang'
import { mediaKey, externalIdsOf } from '$lib/catalog/identity'
import type { LocalLibraryState } from '$lib/library/local-lists'
import type { HistoryEntry } from '$lib/player/history'
import { profiledPersisted } from '$lib/profiles/store'

const DAY = 86_400_000
const MAX_RECORDS = 500

export type DiscoveryQueueAction = 'skip' | 'dismiss' | 'save'

export interface DiscoveryTasteMedia {
  id: number
  catalog?: Media['catalog']
  type?: Media['type']
  format?: string
  title: Media['title']
  genres?: string[]
  originalLanguage?: string
  externalIds?: Media['externalIds']
  idMal?: number
  countryOfOrigin?: string
  startDate?: Media['startDate']
  tags?: Media['tags']
  studios?: Media['studios']
  creators?: Media['creators']
  staff?: Media['staff']
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
  at?: number
  priority?: number
  source?: string
}

export interface DiscoveryQueueItem {
  media: Media
  score: number
  reason: string
  evidence: string[]
  exploration: boolean
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
    externalIds: externalIdsOf(media),
    countryOfOrigin: media.countryOfOrigin,
    startDate: media.startDate,
    tags: media.tags?.filter(tag => !tag.isGeneralSpoiler && !tag.isMediaSpoiler).slice(0, 8),
    studios: media.studios,
    creators: media.creators?.slice(0, 6),
    staff: media.staff ? { edges: media.staff.edges.slice(0, 8) } : undefined,
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
    return Math.abs(weight) < 0.05 ? [] : [{ media: tasteSnapshot(entry.media), weight, at: entry.updatedAt, priority: 2, source: 'library' }]
  })
}

export function historyTasteSeeds(history: Record<number, HistoryEntry>, now = Date.now()): DiscoveryTasteSeed[] {
  return Object.values(history).map((entry) => {
    const ageDays = Math.max(0, now - entry.updatedAt) / DAY
    const recency = Math.exp(-ageDays / 180)
    const total = Math.max(1, entry.media.episodes ?? entry.progress ?? 1)
    const completion = Math.min(1, Math.max(entry.progress, entry.episode * 0.35) / total)
    return { media: tasteSnapshot(entry.media), weight: 0.35 + recency * 0.3 + completion * 0.35, at: entry.updatedAt, priority: 1, source: 'watch history' }
  })
}

export function feedbackTasteSeeds(state: DiscoveryQueueFeedbackState): DiscoveryTasteSeed[] {
  return Object.values(state?.records ?? {}).flatMap((record) => {
    if (record.action === 'skip') return []
    return [{ media: record.media, weight: record.action === 'save' ? 1.1 : -1.4, at: record.at, priority: 3, source: 'discovery choices' }]
  })
}

interface RankOptions {
  excludedKeys?: Iterable<string>
  now?: number
  limit?: number
}

/** Provider-neutral features for the shared engine and TV snapshot protocol. */
export function discoveryTasteItem(media: DiscoveryTasteMedia & Partial<Pick<Media, 'averageScore' | 'ratings'>>): TasteItem {
  const ids = externalIdsOf(media)
  const kind = media.format === 'MOVIE' || media.catalog?.type === 'movie' ? 'movie'
    : media.type === 'MANGA' || media.catalog?.type === 'manga' ? 'manga' : 'show'
  const provider = media.catalog?.provider ?? 'anilist'
  return {
    key: mediaKey(media),
    aliases: Object.entries(ids).filter(([, value]) => value != null).map(([provider, value]) => `external:${provider}:${provider === 'tmdb' || provider === 'tvdb' ? kind + ':' : ''}${value}`),
    title: media.title.userPreferred || media.title.english || media.title.romaji || media.title.native || 'Untitled',
    provider: media.catalog?.sourceName ? provider + ':' + media.catalog.sourceName : provider,
    kind,
    genres: media.genres,
    language: normalizeLang(media.originalLanguage),
    country: media.countryOfOrigin,
    year: media.startDate?.year,
    tags: media.tags?.filter(tag => !tag.isGeneralSpoiler && !tag.isMediaSpoiler && (tag.rank ?? 100) >= 60).map(tag => tag.name),
    people: [
      ...(media.creators ?? []).map(name => 'creator:' + name),
      ...(media.staff?.edges ?? []).filter(edge => /director|creator|original|screenplay/i.test(edge.role))
        .map(edge => provider + ':' + edge.node.id),
    ],
    studios: media.studios?.nodes?.map(studio => studio.name),
    quality: media.averageScore == null ? undefined : media.averageScore / 100,
    votes: media.ratings?.find(rating => rating.votes != null)?.votes,
  }
}

export function rankDiscoveryQueue(
  candidates: Media[],
  seeds: DiscoveryTasteSeed[],
  feedback: DiscoveryQueueFeedbackState,
  options: RankOptions = {},
): DiscoveryQueueItem[] {
  const now = options.now ?? Date.now()
  const hidden = Object.entries(feedback?.records ?? {}).filter(([, value]) => discoveryDecisionHides(value, now))
  const excluded = [
    ...options.excludedKeys ?? [],
    ...hidden.flatMap(([key, value]) => [key, ...(discoveryTasteItem(value.media).aliases ?? [])]),
  ]
  const byKey = new Map(candidates.map(media => [mediaKey(media), media]))
  return rankRecommendations(candidates.map(discoveryTasteItem), seeds.map(seed => ({
    item: discoveryTasteItem(seed.media), weight: seed.weight, at: seed.at, priority: seed.priority, source: seed.source,
  })), { now, excluded, limit: options.limit })
    .map(item => ({ ...item, media: byKey.get(item.key)! }))
}
