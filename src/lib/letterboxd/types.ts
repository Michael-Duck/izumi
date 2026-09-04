import type { Media } from '$lib/anilist/types'

export type LetterboxdImportCategory = 'diary' | 'watched' | 'ratings' | 'watchlist' | 'list'

export interface LetterboxdImportRecord {
  key: string
  title: string
  year?: number
  uri?: string
  rating?: number
  watchedDate?: string
  addedDate?: string
  review?: string
  tags?: string
  rewatch?: boolean
  categories: LetterboxdImportCategory[]
}

export interface LetterboxdFeedEntry {
  key: string
  media: Media
  uri: string
  watchedDate?: string
  publishedAt?: string
  rating?: number
  liked: boolean
  rewatch: boolean
  review?: string
}

export interface LetterboxdImportResult {
  records: LetterboxdImportRecord[]
  files: string[]
}

export interface LetterboxdResolvedItem {
  record: LetterboxdImportRecord
  media: Media
}
