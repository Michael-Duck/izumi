import { profiledPersisted } from '$lib/profiles/store'
import type { Media } from '$lib/anilist/types'
import type { LetterboxdFeedEntry, LetterboxdImportRecord } from './types'

export const letterboxdUsername = profiledPersisted('letterboxd-username', '')
export const letterboxdFeedCache = profiledPersisted<LetterboxdFeedEntry[]>('letterboxd-feed-cache', [])
export const letterboxdFeedUpdatedAt = profiledPersisted('letterboxd-feed-updated-at', 0)
export const letterboxdImportedRecords = profiledPersisted<LetterboxdImportRecord[]>('letterboxd-imported-records', [])
export const letterboxdImportedAt = profiledPersisted('letterboxd-imported-at', 0)
export const letterboxdMediaCache = profiledPersisted<Record<string, Media>>('letterboxd-media-cache', {})
