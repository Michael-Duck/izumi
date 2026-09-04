// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { get } from 'svelte/store'
import { letterboxdImportedRecords } from './config'
import { importedLetterboxdItems, parseCsv, parseLetterboxdCsv, readLetterboxdImport } from './import'

describe('Letterboxd export import', () => {
  beforeEach(() => {
    localStorage.clear()
    letterboxdImportedRecords.set([])
  })

  it('parses RFC-style quoted commas, quotes, and line breaks', () => {
    expect(parseCsv('Name,Review\r\n"Paris, Texas","He said ""wow"".\nStill great."')).toEqual([
      ['Name', 'Review'],
      ['Paris, Texas', 'He said "wow".\nStill great.'],
    ])
  })

  it('recognizes official export headers and normalizes a diary record', () => {
    const records = parseLetterboxdCsv(
      'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Watched Date\n2026-09-04,"Paris, Texas",1984,https://letterboxd.com/film/paris-texas/,4.5,Yes,2026-09-03',
      'diary',
    )
    expect(records[0]).toMatchObject({
      title: 'Paris, Texas', year: 1984, rating: 4.5, rewatch: true,
      watchedDate: '2026-09-03', categories: ['diary'],
    })
  })

  it('reads the official ZIP shape and merges the same film across library files', async () => {
    const archive = zipSync({
      'diary.csv': strToU8('Name,Year,Letterboxd URI,Rating,Watched Date\nPerfect Days,2023,https://letterboxd.com/film/perfect-days-2023/,4.5,2026-09-01'),
      'watchlist.csv': strToU8('Name,Year,Letterboxd URI\nPerfect Days,2023,https://letterboxd.com/film/perfect-days-2023/'),
      'profile.csv': strToU8('Username\nmira'),
    })
    const file = new File([archive], 'letterboxd-export.zip', { type: 'application/zip' })
    const result = await readLetterboxdImport(file)
    expect(result.files).toEqual(expect.arrayContaining(['diary.csv', 'watchlist.csv']))
    expect(result.records).toHaveLength(1)
    expect(result.records[0].categories).toEqual(['diary', 'watchlist'])
    expect(get(letterboxdImportedRecords)).toHaveLength(1)
  })

  it('projects only resolved films for a requested native rail', () => {
    const records = parseLetterboxdCsv('Name,Year\nPerfect Days,2023', 'watchlist')
    const media = { id: 1, title: { userPreferred: 'Perfect Days' } }
    expect(importedLetterboxdItems(records, { [records[0].key]: media }, 'watchlist')).toEqual([{ record: records[0], media }])
    expect(importedLetterboxdItems(records, { [records[0].key]: media }, 'diary')).toEqual([])
  })
})
