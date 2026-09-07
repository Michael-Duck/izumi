import type { Media } from '$lib/anilist/types'
import { anilistIdOf } from '$lib/catalog/identity'

/** MAL and Kitsu publish planned totals. Fill in confirmed releases without requiring AniList. */
export async function hydrateAnimeAiring(media: Media): Promise<Media> {
  if (!['RELEASING', 'HIATUS', 'NOT_YET_RELEASED'].includes(media.status ?? '')) return media
  const id = anilistIdOf(media)
  if (id == null) return media
  try {
    const { getAiringProgress, scheduleTitles } = await import('./animeschedule')
    const progress = await getAiringProgress(id, scheduleTitles(media.title))
    if (!progress) return media
    const total = media.episodes && media.episodes > 0 ? media.episodes : Infinity
    const airedEpisodes = Math.min(total, progress.airedEpisodes)
    const enriched: Media = {
      ...media, airedEpisodes,
      nextAiringEpisode: null, airingSchedule: { ...media.airingSchedule, nodes: [] },
    }
    const next = progress.nextEpisode, at = progress.nextAiringAt
    if (next != null && at != null && next <= total) {
      enriched.nextAiringEpisode = {
        __typename: 'AiringSchedule', episode: next, airingAt: at,
        timeUntilAiring: Math.max(0, at - Math.floor(Date.now() / 1000)),
      } as unknown as NonNullable<Media['nextAiringEpisode']>
    }
    // GraphQL projections cannot request the provider-only airedEpisodes field. Preserve the
    // confirmed count through graphcache even when there is no next-air countdown.
    if (airedEpisodes > 0 && !enriched.nextAiringEpisode) {
      enriched.airingSchedule = {
        __typename: 'AiringScheduleConnection',
        nodes: [{ __typename: 'AiringSchedule', episode: enriched.airedEpisodes, airingAt: Math.floor(Date.now() / 1000) - 1 }],
      } as unknown as NonNullable<Media['airingSchedule']>
    }
    return enriched
  } catch { return media }
}
