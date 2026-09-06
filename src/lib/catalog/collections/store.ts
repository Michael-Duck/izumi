import { persisted } from 'svelte-persisted-store'
import type { HomeCollection } from './model'

// Like the other Home layout preferences, collections are shared across local profiles.
// Catalog results still pass through the active profile's content filter.
export const homeCollections = persisted<HomeCollection[]>('catalog-collections-v1', [], {
  onWriteError: () => { throw new Error('Could not save collections. Free some local storage or import a smaller collection file.') },
})
