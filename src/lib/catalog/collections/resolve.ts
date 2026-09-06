import { collectionTmdbRequest } from './requests'
export { collectionTmdbRequest } from './requests'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { phttp } from '$lib/net/http'
import { activeProfile } from '$lib/profiles/store'
import { profileAllowsMedia } from '$lib/profiles/content'
import { showAdult } from '$lib/settings/ui'
import { enabledAddonUrls } from '$lib/stremio/sources'
import { fetchManifest, type AddonManifest, type AddonCatalog } from '$lib/stremio/manifest'
import { mapStremioMeta, stremioCatalogUrl, type StremioMeta } from '../providers/stremio'
import { mapTmdb, tmdb, type TmdbListItem } from '../providers/tmdb'
import { mapTraktMedia, type TraktRawMedia } from '$lib/trakt/catalog'
import { traktFetch } from '$lib/trakt/client'
import type { CollectionSource } from './model'

export interface InstalledCollectionAddon { base: string; manifest: AddonManifest }
export interface CollectionSourcePage { media: Media[]; next?: number }

export async function collectionAddons(): Promise<InstalledCollectionAddon[]> {
  const addons = await Promise.all(get(enabledAddonUrls).map(async (base) => ({ base, manifest: await fetchManifest(base) })))
  return addons.filter((addon): addon is InstalledCollectionAddon => !!addon.manifest?.catalogs?.length)
}

/** Match Nuvio's declared add-on first, including its legacy comma-suffix fallback. */
export function resolveCollectionAddon(source: CollectionSource, addons: InstalledCollectionAddon[]): { base: string; catalog: AddonCatalog } | undefined {
  const match = (addon: InstalledCollectionAddon, legacy = false) => {
    const catalog = addon.manifest.catalogs?.find((entry) => entry.type === source.type
      && (entry.id === source.catalogId || (legacy && entry.id === source.catalogId?.split(',')[0])))
    return catalog ? { base: addon.base, catalog } : undefined
  }
  for (const addon of addons.filter((addon) => addon.manifest.id === source.addonId)) {
    const result = match(addon) ?? match(addon, true)
    if (result) return result
  }
  for (const addon of addons) {
    const result = match(addon)
    if (result) return result
  }
}

export function uniqueCollectionMedia(media: Media[]): Media[] {
  const profile = get(activeProfile)
  const adult = get(showAdult)
  const unique = new Map<string, Media>()
  for (const item of media) {
    if (!profileAllowsMedia(item, profile) || (!adult && item.isAdult)) continue
    const key = item.catalog ? `${item.catalog.provider}:${item.catalog.type}:${item.catalog.id}` : String(item.id)
    if (!unique.has(key)) unique.set(key, item)
  }
  return [...unique.values()]
}

export async function loadCollectionSource(
  source: CollectionSource, cursor = 1, signal?: AbortSignal, addons?: InstalledCollectionAddon[],
): Promise<CollectionSourcePage> {
  signal?.throwIfAborted()
  if (source.provider === 'addon') {
    const resolved = resolveCollectionAddon(source, addons ?? await collectionAddons())
    signal?.throwIfAborted()
    if (!resolved) throw new Error(`Enable an add-on providing ${source.type} / ${source.catalogId} in Settings → Sources (original add-on: ${source.addonId}).`)
    const extras = resolved.catalog.extra ?? []
    const required = extras.filter((extra) => extra.isRequired && extra.name !== 'skip' && !(extra.name === 'genre' && source.genre))
    if (required.length) throw new Error(`This catalog requires ${required.map((extra) => extra.name).join(', ')}. Configure its source before browsing.`)
    const genres = extras.find((extra) => extra.name === 'genre')?.options ?? resolved.catalog.genres
    if (source.genre && genres?.length && !genres.includes(source.genre)) throw new Error(`This add-on does not provide the collection's genre: ${source.genre}.`)
    const skip = cursor - 1
    const response = await phttp(stremioCatalogUrl(resolved.base, resolved.catalog, { genre: source.genre, ...(skip ? { skip } : {}) }), {
      signal, timeoutMs: 15000, maxBytes: 4 * 1024 * 1024,
    })
    if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}.`)
    const raw = await response.json() as { metas?: StremioMeta[] }
    if (!Array.isArray(raw.metas)) throw new Error('This catalog did not return a metas array.')
    const media = raw.metas.flatMap((item) => mapStremioMeta(item, resolved.base, source.type) ?? [])
    return { media: uniqueCollectionMedia(media), next: raw.metas.length && extras.some((extra) => extra.name === 'skip') ? cursor + raw.metas.length : undefined }
  }
  if (source.provider === 'tmdb') {
    const request = collectionTmdbRequest(source, cursor)
    const raw = await tmdb<Record<string, unknown>>(request.path, { ...request.params, include_adult: get(showAdult) }, signal)
    if (!Array.isArray(raw[request.field])) throw new Error('TMDB returned no collection items.')
    let items = raw[request.field] as Array<TmdbListItem & { job?: string }>
    if (request.field === 'crew') items = items.filter((item) => item.job?.toLowerCase() === 'director')
    if (request.field === 'crew' || request.field === 'cast') items = items.filter((item) => item.media_type === request.kind)
    if (request.field !== 'results' && source.sortBy && source.sortBy !== 'original') {
      items = [...items].sort((a, b) => {
        if (source.sortBy === 'vote_average.desc') return (b.vote_average ?? 0) - (a.vote_average ?? 0)
        if (source.sortBy === 'vote_count.desc') return (b.vote_count ?? 0) - (a.vote_count ?? 0)
        if (source.sortBy?.includes('date.desc')) return (b.release_date ?? b.first_air_date ?? '').localeCompare(a.release_date ?? a.first_air_date ?? '')
        return 0 // Nuvio preserves list order for its popularity/default option.
      })
    }
    const media = items.flatMap((item) => mapTmdb(item, request.field === 'items' && item.media_type === 'tv' ? 'tv' : request.kind) ?? [])
    return { media: uniqueCollectionMedia(media), next: ['results', 'items'].includes(request.field) && cursor < Number(raw.total_pages) ? cursor + 1 : undefined }
  }
  if (source.provider === 'trakt') {
    const kind = ['tv', 'series', 'show'].includes(source.mediaType ?? '') ? 'show' : 'movie'
    const sort = source.sortBy ?? 'rank'
    const direction = source.sortHow ?? 'asc'
    if (!['rank', 'added', 'title', 'released', 'runtime', 'popularity', 'percentage', 'votes'].includes(sort) || !['asc', 'desc'].includes(direction)) throw new Error('Unsupported Trakt list sorting.')
    const response = await traktFetch(`/lists/${source.traktListId}/items/${kind}/${sort}/${direction}?extended=full,images&page=${cursor}&limit=50`, { signal })
    if (!response) throw new Error('Connect Trakt in Settings → Accounts to browse this list.')
    if (!response.ok) throw new Error(`Trakt list returned HTTP ${response.status}.`)
    const items = await response.json() as Array<{ movie?: TraktRawMedia; show?: TraktRawMedia }>
    if (!Array.isArray(items)) throw new Error('Trakt returned an invalid list.')
    const media = items.flatMap((item) => mapTraktMedia(item[kind] ?? {}, kind)?.media ?? [])
    const count = Number(response.headers.get('X-Pagination-Page-Count'))
    return { media: uniqueCollectionMedia(media), next: count > cursor || (!count && items.length === 50) ? cursor + 1 : undefined }
  }
  throw new Error(`This collection uses an unsupported provider: ${source.provider}.`)
}

export const collectionSourceTitle = (source: CollectionSource, index: number) => source.title
  || (source.provider === 'addon' ? source.genre || source.catalogId : `${source.provider.toUpperCase()} ${source.tmdbSourceType ?? 'list'}`)
  || `Catalog ${index + 1}`
