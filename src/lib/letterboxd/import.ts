import { strFromU8, unzip } from 'fflate'
import { get } from 'svelte/store'
import { loadCatalogProvider } from '$lib/catalog/registry'
import { activeProfile } from '$lib/profiles/store'
import { profileAllowsMedia } from '$lib/profiles/content'
import {
  letterboxdImportedAt,
  letterboxdImportedRecords,
  letterboxdMediaCache,
} from './config'
import type {
  LetterboxdImportCategory,
  LetterboxdImportRecord,
  LetterboxdImportResult,
  LetterboxdResolvedItem,
} from './types'

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_RECORDS = 10_000
const MAX_CACHED_MEDIA = 300

export function parseCsv(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = source.charCodeAt(0) === 0xfeff ? 1 : 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += char
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row) }
  return rows
}

function categoryFor(path: string): LetterboxdImportCategory | null {
  const name = path.replace(/\\/g, '/').toLowerCase()
  if (name.endsWith('/diary.csv') || name === 'diary.csv') return 'diary'
  if (name.endsWith('/watched.csv') || name === 'watched.csv') return 'watched'
  if (name.endsWith('/ratings.csv') || name === 'ratings.csv') return 'ratings'
  if (name.endsWith('/watchlist.csv') || name === 'watchlist.csv') return 'watchlist'
  if (name.includes('/lists/') && name.endsWith('.csv')) return 'list'
  return null
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function recordKey(title: string, year?: number, uri?: string): string {
  if (uri) return uri.toLowerCase().replace(/\/$/, '')
  return `${title.trim().toLowerCase()}:${year ?? ''}`
}

export function parseLetterboxdCsv(source: string, category: LetterboxdImportCategory): LetterboxdImportRecord[] {
  const [header = [], ...rows] = parseCsv(source)
  const columns = new Map(header.map((name, index) => [normalizeHeader(name), index]))
  const value = (row: string[], ...names: string[]) => {
    const index = names.map((name) => columns.get(normalizeHeader(name))).find((item) => item != null)
    return index == null ? '' : row[index]?.trim() ?? ''
  }
  return rows.flatMap((row) => {
    const title = value(row, 'Name', 'Title')
    if (!title) return []
    const year = Number(value(row, 'Year')) || undefined
    const uriValue = value(row, 'Letterboxd URI', 'URL')
    const uri = /^https:\/\/letterboxd\.com\//i.test(uriValue) ? uriValue : undefined
    const rating = Number(value(row, 'Rating')) || undefined
    return [{
      key: recordKey(title, year, uri),
      title,
      year,
      uri,
      rating: rating && rating <= 5 ? rating : undefined,
      watchedDate: value(row, 'Watched Date', 'WatchedDate') || undefined,
      addedDate: value(row, 'Date') || undefined,
      review: value(row, 'Review') || undefined,
      tags: value(row, 'Tags') || undefined,
      rewatch: /^(true|yes|1)$/i.test(value(row, 'Rewatch')) || undefined,
      categories: [category],
    }]
  })
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => unzip(bytes, (error, files) => error ? reject(error) : resolve(files)))
}

function mergeRecords(records: LetterboxdImportRecord[]): LetterboxdImportRecord[] {
  const merged = new Map<string, LetterboxdImportRecord>()
  for (const record of records) {
    const existing = merged.get(record.key)
    if (!existing) { merged.set(record.key, record); continue }
    merged.set(record.key, {
      ...existing,
      ...Object.fromEntries(Object.entries(record).filter(([, value]) => value != null && value !== '')),
      categories: [...new Set([...existing.categories, ...record.categories])],
    })
  }
  return [...merged.values()]
    .sort((left, right) => (right.watchedDate ?? right.addedDate ?? '').localeCompare(left.watchedDate ?? left.addedDate ?? ''))
    .slice(0, MAX_RECORDS)
}

export async function readLetterboxdImport(file: File): Promise<LetterboxdImportResult> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Letterboxd imports are limited to 50 MB.')
  const files: Record<string, Uint8Array> = file.name.toLowerCase().endsWith('.zip')
    ? await unzipAsync(new Uint8Array(await file.arrayBuffer()))
    : { [file.name]: new Uint8Array(await file.arrayBuffer()) }
  const parsed: LetterboxdImportRecord[] = []
  const used: string[] = []
  for (const [path, bytes] of Object.entries(files)) {
    const category = categoryFor(path)
    if (!category) continue
    used.push(path)
    parsed.push(...parseLetterboxdCsv(strFromU8(bytes), category))
  }
  if (!used.length) throw new Error('No diary, watched, ratings, Watchlist, or list CSV was found in this file.')
  const records = mergeRecords(parsed)
  if (!records.length) throw new Error('The Letterboxd export contained no recognizable films.')
  letterboxdImportedRecords.set(records)
  letterboxdImportedAt.set(Date.now())
  return { records, files: used }
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

async function resolveRecord(record: LetterboxdImportRecord): Promise<LetterboxdResolvedItem | null> {
  const provider = await loadCatalogProvider('tmdb')
  const page = await provider.search({ query: record.title, type: 'movie', year: record.year, page: 1 })
  const target = normalizedTitle(record.title)
  const media = page.media.find((item) =>
    normalizedTitle(item.title.english ?? item.title.userPreferred ?? '') === target
    && (!record.year || !item.startDate?.year || Math.abs(item.startDate.year - record.year) <= 1))
    ?? page.media[0]
  if (!media || !profileAllowsMedia(media, get(activeProfile))) return null
  return { record, media }
}

export async function resolveLetterboxdRecords(
  records: LetterboxdImportRecord[],
  limit = 60,
  onProgress?: (resolved: number, total: number) => void,
): Promise<LetterboxdResolvedItem[]> {
  const initialCache = get(letterboxdMediaCache)
  const unresolved = records.filter((record) => !initialCache[record.key]).slice(0, limit)
  let completed = 0
  const resolved: LetterboxdResolvedItem[] = []
  for (let start = 0; start < unresolved.length; start += 3) {
    const batch = await Promise.all(unresolved.slice(start, start + 3).map((record) =>
      resolveRecord(record).catch(() => null)))
    resolved.push(...batch.filter((item): item is LetterboxdResolvedItem => !!item))
    completed += batch.length
    onProgress?.(completed, unresolved.length)
  }
  if (resolved.length) {
    letterboxdMediaCache.update((cache) => Object.fromEntries([
      ...Object.entries(cache),
      ...resolved.map((item) => [item.record.key, item.media] as const),
    ].slice(-MAX_CACHED_MEDIA)))
  }
  return resolved
}

export function importedLetterboxdItems(
  records: LetterboxdImportRecord[],
  cache: Record<string, import('$lib/anilist/types').Media>,
  category: LetterboxdImportCategory,
  limit = 30,
): LetterboxdResolvedItem[] {
  return records.flatMap((record) => record.categories.includes(category) && cache[record.key]
    ? [{ record, media: cache[record.key] }]
    : []).slice(0, limit)
}
