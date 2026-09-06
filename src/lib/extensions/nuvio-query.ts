import type { Media } from '$lib/anilist/types'
import type { ExtIds } from '$lib/anizip'
import { externalIdsOf } from '$lib/catalog/identity'
import type { SnVideoSource, SnVideoSubtitle } from '$lib/stremio/onlinestream'

export const nuvioMediaType = (media: Media): 'movie' | 'tv' =>
  media.catalog?.type === 'movie' || media.type === 'MOVIE' || media.format === 'MOVIE' ? 'movie' : 'tv'

/** Keep catalogue episode addressing and AniZip mappings intact; never use an AniList id as TMDB. */
export function nuvioQueryArgs(media: Media, episode: number | undefined, mapped: ExtIds = {}):
  [string, 'movie'] | [string, 'tv', number, number] {
  const id = String(mapped.tmdbId ?? externalIdsOf(media).tmdb ?? '')
  if (!/^[1-9]\d*$/.test(id)) throw new Error('This title has no TMDB mapping for Nuvio providers.')
  const type = nuvioMediaType(media)
  if (type === 'movie') return [id, type]
  const video = media.videos?.find((video) => video.number === episode)
  const season = video?.season ?? mapped.season ?? media.seasonNumber
  const number = video?.episode ?? mapped.episodeNumber ?? episode
  if (!Number.isInteger(season) || season! < 0 || !Number.isInteger(number) || number! < 1) {
    throw new Error('This episode has no season/episode mapping for Nuvio providers.')
  }
  return [id, type, season!, number!]
}

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined
function httpUrl(value: unknown): string | undefined {
  if (!text(value)) return undefined
  try { return /^https?:$/.test(new URL(value as string).protocol) ? value as string : undefined }
  catch { return undefined }
}
function headers(value: unknown): Record<string, string> | undefined {
  if (!object(value)) return undefined
  return Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] =>
    typeof pair[1] === 'string' && !/[\r\n]/.test(pair[0] + pair[1])))
}

/** Keep only playable direct streams, accepting the subtitle spellings used by Nuvio bundles. */
export function nuvioVideoSources(raw: unknown): Array<{ video: SnVideoSource; title?: string; description?: string }> {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!object(entry)) return []
    const url = httpUrl(entry.url)
    if (!url) return []
    const hints = object(entry.behaviorHints) ? entry.behaviorHints : {}
    const proxyHeaders = object(hints.proxyHeaders) ? hints.proxyHeaders : {}
    const quality = text(entry.quality) ?? (typeof entry.quality === 'number' ? `${entry.quality}p` : undefined)
      ?? `${entry.name ?? ''} ${entry.title ?? ''}`.match(/\b(2160p|1080p|720p|480p|360p|4k)\b/i)?.[1]
    const subtitles: SnVideoSubtitle[] = Array.isArray(entry.subtitles) ? entry.subtitles.flatMap((subtitle) => {
      if (!object(subtitle)) return []
      const subUrl = httpUrl(subtitle.url ?? subtitle.file)
      return subUrl ? [{ url: subUrl, lang: text(subtitle.lang ?? subtitle.language),
        label: text(subtitle.label), headers: headers(subtitle.headers),
        isDefault: subtitle.isDefault === true || subtitle.default === true }] : []
    }) : []
    return [{
      title: text(hints.filename) ?? text(entry.title), description: text(entry.description),
      video: {
        url, quality, server: text(entry.name),
        type: text(entry.type) ?? (/\.m3u8(?:[?#]|$)/i.test(url) ? 'm3u8' : /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : 'mp4'),
        headers: headers(entry.headers) ?? headers(proxyHeaders.request), subtitles,
        audio: entry.audio === 'sub' || entry.audio === 'dub' ? entry.audio : undefined,
        audioLang: text(entry.audioLang ?? entry.language), drm: entry.drm,
      },
    }]
  })
}
