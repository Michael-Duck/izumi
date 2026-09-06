import type { Media } from '$lib/anilist/types'
import { compatibilityMediaId, externalIdsOf } from '$lib/catalog/identity'
import { decodeStremioIdentity, mapStremioMeta } from '$lib/catalog/providers/stremio'
import { addonOriginId, normalizeBase } from '$lib/stremio/sources'
import { collectionImageUrl } from '$lib/catalog/collections/model'
import type { CloudItem } from './cloud'

/** Only map known cross-catalog identities. Anime season numbering must never be guessed. */
export function mediaToCloud(media: Media): CloudItem | null {
  if (media.type === 'MANGA' || media.catalog?.type === 'manga') return null
  const external = externalIdsOf(media)
  const native = media.catalog?.provider === 'stremio' ? decodeStremioIdentity(media.catalog.id) : null
  const content_type = media.catalog?.type === 'movie' || media.type === 'MOVIE' || media.format === 'MOVIE' ? 'movie' : 'series'
  const content_id = native?.id || external.imdb || (external.tmdb ? `tmdb:${external.tmdb}` : '')
  if (!content_id) return null
  return { content_id, content_type, name: media.title.userPreferred || media.title.english || media.title.romaji || content_id,
    poster: collectionImageUrl(media.coverImage?.extraLarge || media.coverImage?.large) ?? null, poster_shape: 'POSTER',
    background: collectionImageUrl(media.bannerImage) ?? null, description: media.description, genres: media.genres,
    release_info: media.seasonYear ? String(media.seasonYear) : undefined }
}
export function cloudMatchesMedia(row: CloudItem, media: Media): boolean {
  const candidate = mediaToCloud(media)
  if (!candidate || candidate.content_type !== row.content_type) return false
  const ids = externalIdsOf(media)
  return candidate.content_id === row.content_id || !!ids.imdb && row.content_id === ids.imdb || !!ids.tmdb && row.content_id === `tmdb:${ids.tmdb}`
}
export function cloudToMedia(row: CloudItem, enabledSources: string[]): Media | null {
  const title = row.name || row.title || row.content_id
  const poster = collectionImageUrl(row.poster)
  const tmdb = /^tmdb:(\d+)$/.exec(row.content_id)
  if (tmdb) {
    const catalog = { provider: 'tmdb' as const, type: row.content_type, id: tmdb[1] }
    return { id: compatibilityMediaId(catalog), catalog, externalIds: { tmdb: Number(tmdb[1]) }, type: row.content_type === 'movie' ? 'MOVIE' : 'SERIES',
      title: { userPreferred: title }, coverImage: { large: poster, extraLarge: poster }, bannerImage: collectionImageUrl(row.background),
      description: typeof row.description === 'string' ? row.description : undefined }
  }
  // Use only a source already installed by the user. A cloud URL never installs an add-on.
  const declared = typeof row.addon_base_url === 'string' ? normalizeBase(row.addon_base_url) : ''
  const source = enabledSources.find((url) => declared && normalizeBase(url) === declared)
  if (!source) return null
  return mapStremioMeta({ id: row.content_id, type: row.content_type, name: title, poster }, source, row.content_type)
}
export function cloudEpisode(media: Media, row: CloudItem): number | null {
  if (row.content_type === 'movie') return 1
  if (!Number.isInteger(row.season) || !Number.isInteger(row.episode)) return null
  return media.videos?.find((video) => video.season === row.season && video.episode === row.episode)?.number ?? null
}
export function localEpisode(media: Media, number: number): { season?: number; episode?: number; video_id?: string } | null {
  const row = mediaToCloud(media)
  if (row?.content_type === 'movie') return { video_id: media.videos?.[0]?.id || row.content_id }
  const video = media.videos?.find((video) => video.number === number)
  if (video?.season == null || video.episode == null) return null
  const video_id = video.id || (row && /^(?:tt\d+|tmdb:\d+)$/.test(row.content_id) ? `${row.content_id}:${video.season}:${video.episode}` : undefined)
  return { season: video.season, episode: video.episode, video_id }
}
export function installedCloudSource(media: Media, sources: string[]): string | undefined {
  return media.catalog?.addonId ? sources.find((url) => addonOriginId(url) === media.catalog!.addonId) : undefined
}
