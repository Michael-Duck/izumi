import { nuvioClient, first, object, string } from './auth'
import { collectionImageUrl, parseCollectionImport, type CollectionImport, type HomeCollection, type CollectionAddonRequirement } from '$lib/catalog/collections/model'
import { fetchManifest } from '$lib/stremio/manifest'
import { normalizeBase } from '$lib/stremio/sources'

export interface NuvioItem {
  id: string; title: string; description: string; imageUrl?: string; folderCount: number;
  collectionCount: number; installs: number; kind: 'collection' | 'cover'; portrait: boolean; animated: boolean
}
export interface NuvioPage { items: NuvioItem[]; hasNext: boolean }
export interface NuvioProfile { id: number; name: string; usesPrimaryAddons: boolean }
export interface BrowseOptions {
  page: number; search: string; sort: 'recent' | 'popular'; type: 'all' | 'collection' | 'collection_pack';
  orientation: 'all' | 'landscape' | 'portrait'; format: 'all' | 'gif' | 'jpg' | 'png'
}
const count = (value: unknown) => Math.max(0, Math.trunc(Number(value) || 0))
export function normalizeNuvioItem(value: unknown, kind: NuvioItem['kind']): NuvioItem | null {
  const raw = object(value), envelope = object(raw.envelope), stats = object(raw.stats)
  const id = string(kind === 'cover' ? String(raw.id ?? '') : raw.public_id)
  if (!id || id.length > 500) return null
  const imageUrl = collectionImageUrl(raw.image_url || object(envelope.community).coverImageUrl)
  const collections = Array.isArray(envelope.collections) ? envelope.collections : envelope.collection ? [envelope.collection] : []
  return {
    id, kind, title: string(raw.title) || (kind === 'cover' ? 'Untitled cover' : 'Untitled collection'), description: string(raw.description), imageUrl,
    folderCount: count(stats.folderCount ?? collections.reduce((n, row) => n + (Array.isArray(object(row).folders) ? (object(row).folders as unknown[]).length : 0), 0)),
    collectionCount: count(stats.collectionCount ?? collections.length), installs: count(raw.installs_count),
    portrait: raw.orientation === 'portrait',
    animated: raw.format === 'gif' || raw.is_gif === true || /\.gif(?:[?#]|$)/i.test(imageUrl ?? ''),
  }
}

export function createNuvioApi(client = nuvioClient) {
  async function browse(kind: 'collection' | 'cover', options: BrowseOptions, signal?: AbortSignal): Promise<NuvioPage> {
    const params = new URLSearchParams({ page: String(Math.max(1, options.page)), limit: '24', sort: options.sort })
    if (options.search.trim()) params.set('search', options.search.trim().slice(0, 200))
    if (kind === 'cover') {
      params.set('orientation', options.orientation)
      if (options.format !== 'all') params.set('format', options.format)
    } else if (options.type !== 'all') params.set('type', options.type)
    const raw = object(await client.request('website', `/api/${kind === 'cover' ? 'covers' : 'community-collections'}?${params}`, undefined, signal))
    if (!Array.isArray(raw.items)) throw new Error('Nuvio returned an unreadable gallery. Try again later.')
    const items = raw.items.map((item) => normalizeNuvioItem(item, kind)).filter((item): item is NuvioItem => !!item)
    return { items, hasNext: object(raw.pagination).hasNextPage === true }
  }
  async function community(id: string, signal?: AbortSignal): Promise<CollectionImport> {
    const raw = object(await client.request('website', `/api/community-collections/${encodeURIComponent(id)}`, undefined, signal))
    const item = object(raw.item ?? raw)
    return prepareNuvioImport(item.envelope, `community:${id}`)
  }
  async function profiles(signal?: AbortSignal): Promise<NuvioProfile[]> {
    const raw = await client.request('backend', '/rest/v1/rpc/sync_pull_profiles', {}, signal)
    if (!Array.isArray(raw)) throw new Error('Nuvio returned an unreadable profile list.')
    const rows = raw.map((value) => {
      const row = object(value)
      return { id: Number(row.profile_index ?? row.id), name: string(row.name), usesPrimaryAddons: row.uses_primary_addons === true || row.usesPrimaryAddons === true }
    }).filter((row) => Number.isSafeInteger(row.id) && row.id > 0)
    return rows.length ? rows.map((row) => ({ ...row, name: row.name || `Profile ${row.id}` })) : [{ id: 1, name: 'Profile 1', usesPrimaryAddons: false }]
  }
  async function profileCollections(profile: NuvioProfile, userId: string, signal?: AbortSignal): Promise<HomeCollection[]> {
    const row = first(await client.request('backend', '/rest/v1/rpc/sync_pull_collections', { p_profile_id: profile.id }, signal))
    if (row == null) return []
    const raw = object(row)
    if (!Array.isArray(raw.collections_json)) throw new Error('Nuvio returned unreadable profile collections.')
    if (!raw.collections_json.length) return []
    return (await prepareNuvioImport(raw.collections_json, `profile:${userId}:${profile.id}`)).collections
  }
  async function profileRequirements(collections: HomeCollection[], profile: NuvioProfile, signal?: AbortSignal): Promise<CollectionAddonRequirement[]> {
    const params = new URLSearchParams({ select: '*', profile_id: `eq.${profile.usesPrimaryAddons ? 1 : profile.id}`, order: 'sort_order' })
    const raw = await client.request('backend', `/rest/v1/addons?${params}`, undefined, signal)
    if (!Array.isArray(raw)) throw new Error('Nuvio returned an unreadable source list.')
    const urls = [...new Set(raw.filter((row) => object(row).enabled !== false).map((row) => collectionImageUrl(object(row).url)).filter((url): url is string => !!url))]
    if (urls.length > 100) throw new Error('This Nuvio profile has too many sources to inspect. Add the required manifests in Sources.')
    const wanted = collections.flatMap((collection) => collection.folders.flatMap((folder) => folder.sources.filter((source) => source.provider === 'addon')))
    const found = new Map<string, CollectionAddonRequirement>()
    for (let offset = 0; offset < urls.length; offset += 4) {
      if (signal?.aborted) throw new DOMException('Source lookup cancelled', 'AbortError')
      const results = await Promise.all(urls.slice(offset, offset + 4).map(async (url) => ({ url, manifest: await fetchManifest(normalizeBase(url)) })))
      for (const { url, manifest } of results) {
        if (!manifest || !wanted.some((source) => source.addonId === manifest.id) || found.has(manifest.id)) continue
        found.set(manifest.id, { addonId: manifest.id, addonName: manifest.name, manifestUrl: url, requiredCatalogs: wanted.filter((source) => source.addonId === manifest.id).map((source) => ({
          type: source.type!,
          catalogId: manifest.catalogs?.find((catalog) => catalog.type === source.type && catalog.id === source.catalogId)?.id
            ?? manifest.catalogs?.find((catalog) => catalog.type === source.type && catalog.id === source.catalogId?.split(',')[0])?.id ?? source.catalogId!,
          genre: source.genre,
        })) })
      }
    }
    return [...found.values()]
  }
  return { browse, community, profiles, profileCollections, profileRequirements }
}

/** Namespaces creator/profile IDs, so importing different packs never overwrites an unrelated collection. */
export async function prepareNuvioImport(value: unknown, sourceKey: string): Promise<CollectionImport> {
  const parsed = parseCollectionImport(JSON.stringify(value))
  parsed.collections = await Promise.all(parsed.collections.map(async (collection) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([sourceKey, collection.id])))
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return { ...collection, id: `nuvio-${hash}`, nuvioOrigin: sourceKey }
  }))
  return parsed
}
export const nuvioApi = createNuvioApi()
