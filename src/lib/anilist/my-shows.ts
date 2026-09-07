import { get } from 'svelte/store'
import { anilist } from './client'
import { LIST_IDS_QUERY } from './lists'
import { getMalAnimeIds, getMalListProgress } from '$lib/trackers'
import { getKitsuAnimeIds } from '$lib/trackers/kitsu'
import { getSimklAnimeIds } from '$lib/trackers/simkl'
import { localHistory, type HistoryEntry } from '$lib/player/history'
import { anilistIdOf, externalIdsOf } from '$lib/catalog/identity'
import { localLibrary, localTrackingForMedia, localTrackingRemoved, type LocalLibraryState } from '$lib/library/local-lists'
import type { Media } from './types'
import type { Airing } from './schedule'

// "My shows" = the set the personalized schedule filters/highlights to. Built from three sources so
// it works with a linked tracker OR none at all:
//   - AniList list: CURRENT (watching) + PLANNING (keyed by media.id)
//   - MAL list: watching + plan_to_watch (keyed by idMal — the weekly airings carry media.idMal, so
//     no MAL→AniList id mapping is needed)
//   - Kitsu/Simkl lists (mapped to canonical AniList ids)
//   - Explicit local tracking and completed-episode history — an opened-only episode is just resume
//     history and must not silently enrol the title in My Shows.
// Dropped lists are loaded too, but only as a VETO on the local-history source: dropping a show is a
// tracker edit, and local history has no way to learn about it, so a dropped title used to keep
// airing on the schedule forever just because it had been played on this device once.
export type MineKind = 'watching' | 'planning'
export type ScheduleBadge = MineKind | 'watched'

export interface MySets {
  aniWatching: Set<number>   // AniList media ids
  aniPlanning: Set<number>
  aniDropped: Set<number>
  malWatching: Set<number>   // MAL idMals
  malPlanning: Set<number>
  malDropped: Set<number>
  local: Set<number>         // media ids from on-device history
  library?: LocalLibraryState
  /** Current AniList entries kept as media so a moved/delayed slot can still render a card. */
  aniCurrentMedia: Map<number, Media>
  aniProgress: Map<number, number>
  malProgress: Map<number, number>
  localProgress: Map<number, number>
  progressOverrides: Map<number, number>
}

export const emptyMySets = (): MySets => ({
  aniWatching: new Set(), aniPlanning: new Set(), aniDropped: new Set(),
  malWatching: new Set(), malPlanning: new Set(), malDropped: new Set(),
  local: new Set(),
  aniCurrentMedia: new Map(),
  aniProgress: new Map(), malProgress: new Map(), localProgress: new Map(), progressOverrides: new Map(),
})

/** Is this title on a tracker's Dropped list? */
export function isDropped(m: Media, s: MySets): boolean {
  const mal = externalIdsOf(m).mal
  return s.aniDropped.has(anilistIdOf(m) ?? m.id) || (mal != null && s.malDropped.has(mal))
}

/** How a title relates to the viewer, or null if it isn't one of their shows. Explicit local list
 *  edits take precedence over stale tracker data. Confirmed watch history counts unless dropped. An explicit
 *  Watching/Planning entry always wins over a Dropped one on the OTHER tracker — the drop only vetoes
 *  the implicit local-history signal, so a stale list on one service can't hide a live show. */
export function classifyMine(m: Media, s: MySets): MineKind | null {
  if (s.library) {
    if (localTrackingRemoved(s.library, m)) return null
    const status = localTrackingForMedia(s.library, m)?.status
    if (status === 'CURRENT' || status === 'REPEATING') return 'watching'
    if (status === 'PLANNING') return 'planning'
    if (status) return null // an explicit local edit wins over an old tracker response
  }
  const id = anilistIdOf(m) ?? m.id, idMal = externalIdsOf(m).mal
  if (s.aniWatching.has(id) || (idMal != null && s.malWatching.has(idMal))) return 'watching'
  if (s.aniPlanning.has(id) || (idMal != null && s.malPlanning.has(idMal))) return 'planning'
  if (s.local.has(id) && !isDropped(m, s)) return 'watching'
  return null
}

export const isMine = (m: Media, s: MySets) => classifyMine(m, s) !== null

/** The badge describes this episode, while Watching/Planning still describes future slots. */
export function classifyAiring(airing: Airing, sets: MySets, now = Date.now()): ScheduleBadge | null {
  const media = airing.media
  const mine = classifyMine(media, sets)
  if (airing.delayPlaceholder || airing.episode <= 0 || airing.airingAt * 1000 > now) return mine
  if (sets.library && localTrackingRemoved(sets.library, media)) return null
  const tracking = sets.library && localTrackingForMedia(sets.library, media)
  if (!mine && (isDropped(media, sets) || tracking?.status === 'DROPPED' || tracking?.status === 'PAUSED')) return null
  const id = anilistIdOf(media) ?? media.id
  const mal = externalIdsOf(media).mal
  const progress = sets.progressOverrides.get(id) ?? Math.max(
    sets.aniProgress.get(id) ?? 0,
    mal == null ? 0 : sets.malProgress.get(mal) ?? 0,
    sets.localProgress.get(id) ?? 0,
    tracking?.progress ?? 0,
    media.mediaListEntry?.progress ?? 0,
  )
  return progress >= airing.episode ? 'watched' : mine
}

/** Opening an episode is resume history, not evidence that the user follows the series. */
export function withLocalMyShows(
  sets: MySets,
  history: Record<number, HistoryEntry>,
  library: LocalLibraryState,
  session: Record<number, number> = {},
  overrides: Record<number, number> = {},
): MySets {
  const localProgress = new Map(Object.entries(session).map(([id, progress]) => [Number(id), progress]))
  const progressOverrides = new Map(Object.entries(overrides).map(([id, progress]) => [Number(id), progress]))
  // Native Kitsu history can use a different storage id from the schedule's canonical card.
  const mediaEntries = [...Object.values(history), ...Object.values(library.entries ?? {})]
  for (const entry of mediaEntries) {
    const id = anilistIdOf(entry.media) ?? entry.media.id
    const progress = 'progress' in entry ? entry.progress : entry.tracking?.progress ?? 0
    localProgress.set(id, Math.max(localProgress.get(id) ?? 0, progress, session[entry.media.id] ?? 0))
    if (overrides[entry.media.id] != null) progressOverrides.set(id, overrides[entry.media.id])
  }
  const candidates = [
    ...Object.values(history).filter((entry) => entry.progress > 0).map((entry) => entry.media),
    ...Object.values(library.entries ?? {}).filter((entry) => entry.tracking?.status).map((entry) => entry.media),
  ]
  const local = new Set(candidates.flatMap((media) => {
    if (localTrackingRemoved(library, media)) return []
    const status = localTrackingForMedia(library, media)?.status
    if (status && !['CURRENT', 'REPEATING', 'PLANNING'].includes(status)) return []
    return [anilistIdOf(media) ?? media.id]
  }))
  return { ...sets, local, library, localProgress, progressOverrides }
}

/** True if there's any source the personalized view could draw from (so we know to default to it). */
export function hasMySources(s: MySets): boolean {
  return s.aniWatching.size + s.aniPlanning.size + s.malWatching.size + s.malPlanning.size + s.local.size > 0
}

const ANI_STATUSES = ['CURRENT', 'PLANNING', 'DROPPED', 'COMPLETED'] as const
type AniStatus = typeof ANI_STATUSES[number]
type IdColl = {
  MediaListCollection?: { lists?: { entries?: { status?: string; progress?: number; media: { id: number } }[] }[] }
  current?: { lists?: { entries?: { media: Media }[] }[] }
}

export function splitAniListIds(data: IdColl | undefined): Record<AniStatus, Set<number>> {
  const out: Record<AniStatus, Set<number>> = {
    CURRENT: new Set(), PLANNING: new Set(), DROPPED: new Set(), COMPLETED: new Set(),
  }
  for (const entry of (data?.MediaListCollection?.lists ?? []).flatMap((list) => list.entries ?? [])) {
    if (ANI_STATUSES.includes(entry.status as AniStatus)) out[entry.status as AniStatus].add(entry.media.id)
  }
  return out
}

interface AniData {
  ids: Record<AniStatus, Set<number>>
  currentMedia: Map<number, Media>
  progress: Map<number, number>
}

async function aniIds(userName: string | undefined): Promise<AniData> {
  const empty = () => ({ ids: splitAniListIds(undefined), currentMedia: new Map<number, Media>(), progress: new Map<number, number>() })
  if (!userName) return empty()
  try {
    const r = await anilist.query(LIST_IDS_QUERY, { userName, statuses: ANI_STATUSES }).toPromise()
    if (r.error) return empty()
    const data = r.data as IdColl
    const media = (data.current?.lists ?? []).flatMap((list) => list.entries ?? []).map((entry) => entry.media)
    const entries = (data.MediaListCollection?.lists ?? []).flatMap((list) => list.entries ?? [])
    return {
      ids: splitAniListIds(data), currentMedia: new Map(media.map((item) => [item.id, item])),
      progress: new Map(entries.map((entry) => [entry.media.id, entry.progress ?? 0])),
    }
  } catch { return empty() }
}

/** Load every "my shows" source concurrently. Best-effort — a failing/absent source just contributes
 *  an empty set. `userName` is the linked AniList handle (empty ⇒ AniList sources skipped). */
export async function loadMySets(userName: string | undefined): Promise<MySets> {
  const [ani, malW, malP, malD, malC, kitsuW, kitsuP, kitsuD, simklW, simklP, simklD] = await Promise.all([
    aniIds(userName),
    getMalListProgress('watching', 500),
    getMalAnimeIds('plan_to_watch', 500),
    getMalAnimeIds('dropped', 500),
    getMalListProgress('completed', 500),
    getKitsuAnimeIds('current', 20),
    getKitsuAnimeIds('planned', 20),
    getKitsuAnimeIds('dropped', 20),
    getSimklAnimeIds('watching', 500),
    getSimklAnimeIds('plantowatch', 500),
    getSimklAnimeIds('dropped', 500),
  ])
  return withLocalMyShows({
    ...emptyMySets(),
    aniWatching: new Set([...ani.ids.CURRENT, ...kitsuW, ...simklW]),
    aniPlanning: new Set([...ani.ids.PLANNING, ...kitsuP, ...simklP]),
    aniDropped: new Set([...ani.ids.DROPPED, ...kitsuD, ...simklD]),
    malWatching: new Set(malW.map((entry) => entry.idMal)), malPlanning: new Set(malP), malDropped: new Set(malD),
    aniProgress: ani.progress,
    malProgress: new Map([...malW, ...malC].map((entry) => [entry.idMal, entry.progress])),
    local: new Set(), aniCurrentMedia: ani.currentMedia,
  }, get(localHistory), get(localLibrary))
}
