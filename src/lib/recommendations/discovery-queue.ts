import type { Media } from '$lib/anilist/types'
import { rankRecommendations, type TasteItem } from '$lib/shared/recommendation-engine'
import { normalizeLang } from '$lib/stremio/sublang'
import { mediaKey, externalIdsOf } from '$lib/catalog/identity'
import { tasteMetadata } from '$lib/catalog/taste-metadata'
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
  seasonYear?: number
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
  removed?: Record<string, number>
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
    ...tasteMetadata(media),
    externalIds: externalIdsOf(media),
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
    const removed = { ...state.removed }
    delete removed[mediaKey(media)]
    return { records: trimmed, removed }
  })
}

export function forgetDiscoveryDecision(media: Media, now = Date.now()): void {
  discoveryQueueFeedback.update((state) => {
    const records = { ...(state?.records ?? {}) }
    delete records[mediaKey(media)]
    return { records, removed: Object.fromEntries(Object.entries({ ...state.removed, [mediaKey(media)]: now }).sort((a, b) => b[1] - a[1]).slice(0, MAX_RECORDS)) }
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
    const rated = score != null && Number.isFinite(score) && score > 0
    // A rating is an opinion in its own right. Completing or saving a disliked title cannot
    // turn that opinion positive; a neutral rating also supersedes incidental watch evidence.
    if (rated) weight = (Math.min(100, score) - 60) / 25
    return [{ media: tasteSnapshot(entry.media), weight,
      at: rated ? entry.tracking?.scoreUpdatedAt ?? entry.updatedAt : entry.updatedAt,
      priority: rated || status === 'DROPPED' ? 4 : 2, source: 'library' }]
  })
}

export function historyTasteSeeds(history: Record<number, HistoryEntry>, _now = Date.now()): DiscoveryTasteSeed[] {
  return Object.values(history).flatMap((entry) => {
    // `episode` is only the last opened episode. `progress` is a watched-through marker,
    // not a count of distinct episodes or minutes, and unknown totals imply no completion.
    if (!(entry.progress > 0)) return []
    const total = entry.media.episodes
    const completion = total && total > 0 ? Math.min(1, entry.progress / total) : 0
    return [{ media: tasteSnapshot(entry.media), weight: 0.65 + completion * 0.35,
      at: entry.watchedAt ?? entry.updatedAt, priority: 1, source: 'watch history' }]
  })
}

export function feedbackTasteSeeds(state: DiscoveryQueueFeedbackState): DiscoveryTasteSeed[] {
  return Object.values(state?.records ?? {}).flatMap((record) => {
    if (record.action === 'skip') return []
    return [{ media: record.media, weight: record.action === 'save' ? 1.1 : -1.4, at: record.at,
      priority: record.action === 'save' ? 3 : 4, source: 'discovery choices' }]
  })
}

interface RankOptions {
  excludedKeys?: Iterable<string>
  now?: number
  limit?: number
  signalLimit?: number
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
    year: media.startDate?.year ?? media.seasonYear,
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
  })), { now, excluded, limit: options.limit, signalLimit: options.signalLimit })
    .map(item => ({ ...item, media: byKey.get(item.key)! }))
}

/** Last-write-wins per title, with bounded undo tombstones to prevent stale peers resurrecting a skip. */
export function mergeDiscoveryFeedback(current: DiscoveryQueueFeedbackState, incoming: unknown, now = Date.now()): DiscoveryQueueFeedbackState {
  if (!incoming || typeof incoming !== 'object') return current
  const value = incoming as Partial<DiscoveryQueueFeedbackState>
  const records = { ...current.records }, removed = { ...current.removed }
  for (const [key, at] of Object.entries(value.removed ?? {}).slice(0, MAX_RECORDS)) {
    if (key.length <= 500 && Number.isFinite(at) && at > 0 && at <= now + 60_000 && at > (removed[key] ?? 0)) removed[key] = at
  }
  for (const [key, record] of Object.entries(value.records ?? {}).slice(0, MAX_RECORDS)) {
    if (!record || !['save', 'skip', 'dismiss'].includes(record.action) || !Number.isFinite(record.at)
      || record.at <= 0 || record.at > now + 60_000 || !record.media || !Number.isFinite(record.media.id)
      || !record.media.title || typeof record.media.title !== 'object' || key.length > 500) continue
    try {
      if (mediaKey(record.media) !== key || record.at <= (records[key]?.at ?? 0)) continue
      const media = tasteSnapshot(record.media as Media)
      // Do not admit malformed catalog labels/arrays into rendering or the pure ranker.
      if (!Object.values(media.title).every(title => title == null || typeof title === 'string')
        || media.genres && !media.genres.every(genre => typeof genre === 'string')) continue
      records[key] = { action: record.action, at: record.at, until: record.action === 'skip' ? record.at + 7 * DAY : undefined, media }
    } catch { /* Corrupt peer records are ignored, not allowed to poison profile storage. */ }
  }
  for (const [key, at] of Object.entries(removed)) {
    if ((records[key]?.at ?? 0) <= at) delete records[key]
    else delete removed[key]
  }
  const trim = <T>(items: Record<string, T>, at: (item: T) => number) => Object.fromEntries(Object.entries(items).sort((a, b) => at(b[1]) - at(a[1])).slice(0, MAX_RECORDS))
  return { records: trim(records, record => record.at), removed: trim(removed, at => at) }
}

export function importDiscoveryFeedback(value: unknown): void {
  discoveryQueueFeedback.update(current => {
    const next = mergeDiscoveryFeedback(current, value)
    return JSON.stringify(current) === JSON.stringify(next) ? current : next
  })
}
