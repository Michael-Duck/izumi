import { loadCatalogProvider } from '$lib/catalog/registry'
import { mediaKey } from '$lib/catalog/identity'
import type { Media } from '$lib/anilist/types'
import type { CompanionMedia } from './protocol'

/** Translate native TV coordinates through the same catalog episode table the desktop player
 * uses. Counts alone cannot establish ordering (specials and missing seasons are provider-owned).
 * A null result leaves the checkpoint unapplied and retryable when metadata becomes available. */
export async function resolveCheckpointEpisode(requested: CompanionMedia, known?: Media): Promise<{ episode: number; media?: Media } | null> {
  const key = `${requested.ref.provider}:${requested.ref.type}:${requested.ref.id}`
  if (known && mediaKey(known) !== key) known = undefined
  const episode = requested.episode ?? 1
  if (!Number.isInteger(episode) || episode < 1 || episode > 100_000) return null
  if (requested.season != null && (!Number.isInteger(requested.season) || requested.season < 0 || requested.season > 10_000)) return null
  if (requested.ref.type === 'movie' || requested.mediaKind === 'movie') return { episode: 1, media: known }
  // Without a season the existing protocol carries an absolute episode. Anime catalog titles
  // represent individual runs; their episode numbers are already scoped to that title.
  if (requested.season == null || requested.ref.provider === 'anilist' || requested.ref.provider === 'kitsu') return { episode, media: known }
  const matching = (media?: Media) => media?.videos?.find(video => video.season === requested.season && video.episode === episode)
  const cached = matching(known)
  if (cached) return { episode: cached.number, media: known }
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const media = await Promise.race([
      loadCatalogProvider(requested.ref.provider).then(provider => provider.detail(requested.ref, abort.signal)),
      new Promise<null>(resolve => { timer = setTimeout(() => { abort.abort(); resolve(null) }, 8_000) }),
    ])
    if (!media || mediaKey(media) !== key) return null
    const video = matching(media)
    return video ? { episode: video.number, media } : null
  } catch { return null }
  finally { clearTimeout(timer) }
}
