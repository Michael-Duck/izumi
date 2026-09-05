import type { Media } from '$lib/anilist/types'
import { anilist } from '$lib/anilist/client'
import { MEDIA_BY_ID } from '$lib/anilist/detail-queries'
import { mediaKey, mediaRef } from '$lib/catalog/identity'
import { searchMergedCatalogs } from '$lib/catalog/merged-search'
import { loadCatalogProvider } from '$lib/catalog/registry'
import { mergedCatalogProviders, type CatalogSelection } from '$lib/settings/catalog'

export interface DiscoveryCandidates {
  media: Media[]
  failedProviders: CatalogSelection[]
  hasNextPage: boolean
}

/** Query only enabled catalogs. A failed/missing-key provider must not blank all other picks.
 * Stremio Home includes non-searchable curated lists; search alone would silently omit them. */
export async function loadDiscoveryCandidates(
  providers: unknown,
  page = 1,
  signal?: AbortSignal,
  genre?: string,
): Promise<DiscoveryCandidates> {
  const selections = mergedCatalogProviders(providers)
  const results = await Promise.allSettled(selections.map(async selection => {
    if (selection === 'stremio' && page === 1) {
      const provider = await loadCatalogProvider(selection)
      const home = await provider.home(signal)
      return { media: [...home.hero, ...home.sections.flatMap(section => section.media)], hasNextPage: true }
    }
    return searchMergedCatalogs([selection], '', page, signal, genre)
  }))
  if (signal?.aborted) throw new DOMException('Discovery cancelled', 'AbortError')
  const media = new Map<string, Media>()
  const failedProviders: CatalogSelection[] = []
  let hasNextPage = false
  results.forEach((result, index) => {
    if (result.status === 'rejected') { failedProviders.push(selections[index]); return }
    hasNextPage ||= result.value.hasNextPage
    // Interleave providers below, rather than letting a large add-on list swallow the budget.
  })
  for (let index = 0; index < 100; index++) {
    for (const result of results) {
      const item = result.status === 'fulfilled' ? result.value.media[index] : undefined
      if (item) media.set(mediaKey(item), item)
    }
  }
  if (!media.size && failedProviders.length === selections.length) throw new Error('None of your enabled catalogs could load picks. Check your connection and catalog setup.')
  return { media: [...media.values()], failedProviders, hasNextPage }
}

/** Fetch metadata for the visible title only. Never resolve a stream or start a trailer implicitly. */
export async function discoveryPresentation(media: Media, signal?: AbortSignal): Promise<Media> {
  const ref = mediaRef(media)
  if (ref.provider === 'anilist') {
    const result = await anilist.query<{ Media?: Media }>(MEDIA_BY_ID, { id: Number(ref.id) }).toPromise()
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    return result.data?.Media ? { ...media, ...result.data.Media } : media
  }
  const provider = await loadCatalogProvider(ref.provider)
  // Kitsu/JVM detail may enumerate a long episode list. Keep that work behind Full details.
  if (!provider.presentation) return media
  const result = await provider.presentation(ref, signal)
  return result ? { ...media, ...result } : media
}
