import { get } from 'svelte/store'
import { homeCollections } from './store'
import { mergeCollectionImports, parseCollectionImport, type CollectionImport } from './model'
import { validateCollectionDependencies } from './import'
import { addonUrls, disabledSources, replaceAddonBase } from '$lib/stremio/sources'

export async function installCollectionImport(pending: CollectionImport, selected: number[], signal?: AbortSignal) {
  const bases = await validateCollectionDependencies(pending.requirements.filter((_, index) => selected.includes(index)))
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
  const previous = { collections: get(homeCollections), addons: get(addonUrls), disabled: get(disabledSources) }
  const merged = mergeCollectionImports(previous.collections, pending.collections)
  parseCollectionImport(JSON.stringify(merged))
  try {
    homeCollections.set(merged)
    if (bases.length) {
      addonUrls.set(bases.reduce((urls, base) => replaceAddonBase(urls, undefined, base), previous.addons))
      disabledSources.set(previous.disabled.filter((url) => !bases.includes(url)))
    }
  } catch (error) {
    for (const restore of [() => homeCollections.set(previous.collections), () => addonUrls.set(previous.addons), () => disabledSources.set(previous.disabled)]) {
      try { restore() } catch { /* Restore the in-memory store even if storage writes fail. */ }
    }
    throw error
  }
}
