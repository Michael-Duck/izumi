export interface CollectionSource {
  provider: string
  title?: string
  addonId?: string
  type?: string
  catalogId?: string
  genre?: string
  tmdbSourceType?: string
  tmdbId?: number
  traktListId?: number
  mediaType?: string
  sortBy?: string
  sortHow?: string
  filters?: Record<string, string | number | boolean>
}

export interface CollectionFolder {
  id: string
  title: string
  coverImageUrl?: string
  focusGifUrl?: string
  focusGifEnabled: boolean
  coverEmoji?: string
  tileShape: 'poster' | 'landscape' | 'square'
  hideTitle: boolean
  heroBackdropUrl?: string
  titleLogoUrl?: string
  sources: CollectionSource[]
}

export interface HomeCollection {
  id: string
  nuvioOrigin?: string
  title: string
  backdropImageUrl?: string
  pinToTop: boolean
  viewMode: 'TABBED_GRID' | 'ROWS' | 'FOLLOW_LAYOUT'
  showAllTab: boolean
  folders: CollectionFolder[]
}

export interface CollectionAddonRequirement {
  addonId: string
  addonName: string
  manifestUrl?: string
  requiredCatalogs: Array<{ type: string; catalogId: string; genre?: string }>
}

export interface CollectionImport {
  collections: HomeCollection[]
  requirements: CollectionAddonRequirement[]
}

export const COLLECTION_IMPORT_MAX_BYTES = 8 * 1024 * 1024
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const positiveId = (value: unknown): number | undefined => {
  const id = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

export function collectionImageUrl(value: unknown): string | undefined {
  if (!text(value)) return undefined
  try {
    const url = new URL(text(value))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.href
  } catch { return undefined }
}

function required(value: unknown, label: string): string {
  const result = text(value)
  if (!result || result.length > 500) throw new Error(`${label} must be a nonempty string of at most 500 characters.`)
  return result
}

function source(value: unknown): CollectionSource {
  const raw = record(value)
  const provider = text(raw.provider).toLowerCase() || 'addon'
  const filters: NonNullable<CollectionSource['filters']> = {}
  for (const [key, value] of Object.entries(record(raw.filters))) {
    if (value == null || value === '') continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Invalid collection filter: ${key}`)
    filters[key] = value as string | number | boolean
  }
  const result: CollectionSource = {
    provider, title: text(raw.title) || undefined,
    addonId: text(raw.addonId) || undefined, type: text(raw.type) || undefined,
    catalogId: text(raw.catalogId) || undefined,
    genre: text(raw.genre).toLowerCase() === 'none' ? undefined : text(raw.genre) || undefined,
    tmdbSourceType: text(raw.tmdbSourceType || raw.sourceType).toUpperCase() || undefined,
    tmdbId: positiveId(raw.tmdbId), traktListId: positiveId(raw.traktListId),
    mediaType: text(raw.mediaType).toLowerCase() || undefined,
    sortBy: text(raw.sortBy) || undefined, sortHow: text(raw.sortHow).toLowerCase() || undefined,
    ...(Object.keys(filters).length ? { filters } : {}),
  }
  if (provider === 'addon' && (!result.addonId || !result.type || !result.catalogId)) {
    throw new Error('An add-on catalog needs addonId, type, and catalogId.')
  }
  if (provider === 'tmdb' && (!result.tmdbSourceType || (result.tmdbSourceType !== 'DISCOVER' && !result.tmdbId))) {
    throw new Error('A TMDB source needs a source type and a positive ID (except Discover).')
  }
  if (provider === 'trakt' && !result.traktListId) throw new Error('A Trakt source needs a positive list ID.')
  return result
}

export function isCollectionDocument(value: unknown): boolean {
  const raw = record(value)
  return Array.isArray(raw.collections) || Array.isArray(raw.collections_json)
    || !!raw.collection || Array.isArray(raw.folders)
    || (Array.isArray(value) && value.some((item) => Array.isArray(record(item).folders)))
}

/** Nuvio's array export, individual collection, and community collection/pack envelope. */
export function parseCollectionImport(input: string): CollectionImport {
  if (new TextEncoder().encode(input).length > COLLECTION_IMPORT_MAX_BYTES) throw new Error('Collection files must be smaller than 8 MB.')
  let value: unknown
  try { value = JSON.parse(input.replace(/^\uFEFF/, '')) } catch { throw new Error('This is not valid collection JSON.') }
  const raw = record(value)
  const rows = Array.isArray(value) ? value : raw.collections ?? raw.collections_json ?? (raw.collection ? [raw.collection] : [value])
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw new Error('Import between 1 and 200 collections at a time.')
  let folderCount = 0
  let sourceCount = 0
  const ids = new Set<string>()
  const collections = rows.map((value): HomeCollection => {
    const row = record(value)
    const id = required(row.id, 'Collection ID')
    const title = required(row.title, 'Collection title')
    if (ids.has(id)) throw new Error(`Duplicate collection ID: ${id}`)
    ids.add(id)
    if (!Array.isArray(row.folders)) throw new Error(`${title} has no folders array. Export Collections from Nuvio, rather than an add-on configuration.`)
    const folderIds = new Set<string>()
    const folders = row.folders.map((value): CollectionFolder => {
      if (++folderCount > 2000) throw new Error('Import at most 2,000 folders at a time.')
      const folder = record(value)
      const id = required(folder.id, 'Folder ID')
      const title = required(folder.title, 'Folder title')
      if (folderIds.has(id)) throw new Error(`Duplicate folder ID in ${title}: ${id}`)
      folderIds.add(id)
      const sources = Array.isArray(folder.sources) && folder.sources.length ? folder.sources : folder.catalogSources ?? []
      if (!Array.isArray(sources)) throw new Error(`${title} has an invalid sources array.`)
      sourceCount += sources.length
      if (sourceCount > 10000) throw new Error('Import at most 10,000 catalog sources at a time.')
      return {
        id, title, sources: sources.map(source),
        coverImageUrl: collectionImageUrl(folder.coverImageUrl), focusGifUrl: collectionImageUrl(folder.focusGifUrl),
        focusGifEnabled: folder.focusGifEnabled !== false && folder.mobileFocusGifEnabled !== false,
        coverEmoji: text(folder.coverEmoji) || undefined,
        tileShape: ['landscape', 'wide'].includes(text(folder.tileShape).toLowerCase()) ? 'landscape'
          : text(folder.tileShape).toLowerCase() === 'square' ? 'square' : 'poster',
        hideTitle: folder.hideTitle === true,
        heroBackdropUrl: collectionImageUrl(folder.heroBackdropUrl), titleLogoUrl: collectionImageUrl(folder.titleLogoUrl),
      }
    })
    return {
      id, title, folders, backdropImageUrl: collectionImageUrl(row.backdropImageUrl),
      ...(text(row.nuvioOrigin) && text(row.nuvioOrigin).length <= 1500 ? { nuvioOrigin: text(row.nuvioOrigin) } : {}),
      pinToTop: row.pinToTop === true, showAllTab: row.showAllTab !== false,
      viewMode: row.viewMode === 'ROWS' || row.viewMode === 'FOLLOW_LAYOUT' ? row.viewMode : 'TABBED_GRID',
    }
  })
  const addonRequirements = record(raw.requirements).addons
  const requirements = Array.isArray(addonRequirements) ? addonRequirements.map((value): CollectionAddonRequirement => {
    const addon = record(value)
    const catalogs = Array.isArray(addon.requiredCatalogs) ? addon.requiredCatalogs : []
    return {
      addonId: text(addon.addonId), addonName: text(addon.addonName || addon.name || addon.addonId) || 'Add-on',
      manifestUrl: collectionImageUrl(addon.manifestUrl || addon.url),
      requiredCatalogs: catalogs.map((value) => {
        const catalog = record(value)
        return { type: required(catalog.type, 'Catalog type'), catalogId: required(catalog.catalogId || catalog.id, 'Catalog ID'), genre: text(catalog.genre) || undefined }
      }),
    }
  }) : []
  return { collections, requirements }
}

/** Reimporting updates matching IDs; unrelated collections keep their position and contents. */
export function mergeCollectionImports(current: HomeCollection[], incoming: HomeCollection[]): HomeCollection[] {
  const result = new Map(current.map((collection) => [collection.id, collection]))
  for (const collection of incoming) result.set(collection.id, collection)
  return [...result.values()]
}

export function collectionFolderHref(collectionId: string, folderId?: string): string {
  return `/app/collections?${new URLSearchParams({ collection: collectionId, ...(folderId ? { folder: folderId } : {}) })}`
}
