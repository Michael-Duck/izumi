import { phttp } from '$lib/net/http'
import { fetchManifest } from '$lib/stremio/manifest'
import { normalizeBase } from '$lib/stremio/sources'
import { COLLECTION_IMPORT_MAX_BYTES, collectionImageUrl, parseCollectionImport, type CollectionAddonRequirement } from './model'

export async function readCollectionImport(input: string, signal?: AbortSignal) {
  const value = input.trim()
  if (value.startsWith('[') || value.startsWith('{')) return parseCollectionImport(value)
  const url = collectionImageUrl(value)
  if (!url) throw new Error('Paste collection JSON or a direct HTTP(S) JSON file URL.')
  if (new URL(url).hostname.replace(/^www\./, '') === 'nuvio.tv') {
    throw new Error('Use Browse Nuvio above to connect your account and add community collections directly. For a file import, use Nuvio Account → Collections → Export or Share JSON.')
  }
  const response = await phttp(url, { signal, timeoutMs: 15000, maxBytes: COLLECTION_IMPORT_MAX_BYTES })
  if (!response.ok) throw new Error(`Collection download returned HTTP ${response.status}.`)
  return parseCollectionImport(await response.text())
}

/** Validate every explicitly selected dependency before changing any local settings. */
export async function validateCollectionDependencies(requirements: CollectionAddonRequirement[]): Promise<string[]> {
  return Promise.all(requirements.map(async (requirement) => {
    const base = requirement.manifestUrl ? normalizeBase(requirement.manifestUrl) : ''
    if (!base) throw new Error(`${requirement.addonName} has no installable manifest URL. Add your configured manifest in Settings → Sources.`)
    const manifest = await fetchManifest(base)
    if (!manifest || (requirement.addonId && manifest.id !== requirement.addonId)) throw new Error(`${requirement.addonName}: the included manifest could not be verified.`)
    for (const expected of requirement.requiredCatalogs) {
      const catalog = manifest.catalogs?.find((catalog) => catalog.type === expected.type && catalog.id === expected.catalogId)
      const genres = catalog?.extra?.find((extra) => extra.name === 'genre')?.options
      if (!catalog || (expected.genre && genres?.length && !genres.includes(expected.genre))) {
        throw new Error(`${requirement.addonName} is missing ${expected.type} / ${expected.catalogId}${expected.genre ? ` (${expected.genre})` : ''}.`)
      }
    }
    return base
  }))
}
