import { describe, expect, it } from 'vitest'
import { collectionFolderHref, collectionImageUrl, isCollectionDocument, mergeCollectionImports, parseCollectionImport } from './model'
import { classifySourceDocument } from '$lib/settings/classify-source-spec'

const source = { addonId: 'test.addon', type: 'movie', catalogId: 'list-123', genre: 'Drama' }
const collection = {
  id: 'services', title: 'Streaming services', pinToTop: true, viewMode: 'ROWS',
  folders: [{ id: 'one', title: 'One', tileShape: 'landscape', hideTitle: true, coverImageUrl: 'https://images.test/art.gif', catalogSources: [source] }],
}
const parse = (value: unknown) => parseCollectionImport(JSON.stringify(value))

describe('Nuvio collection imports', () => {
  it.each([
    [collection], collection, { collection }, { collections: [collection], type: 'collection_pack', schemaVersion: 1 },
    { profile_id: 1, collections_json: [collection] },
  ])('accepts array, individual, pack, and sync exports: %j', (value) => {
    const result = parse(value)
    expect(result.collections[0]).toMatchObject({ id: 'services', pinToTop: true, viewMode: 'ROWS' })
    expect(result.collections[0].folders[0]).toMatchObject({
      tileShape: 'landscape', hideTitle: true, coverImageUrl: 'https://images.test/art.gif',
      sources: [{ ...source, provider: 'addon' }],
    })
  })
  it('prefers modern sources without loading duplicate legacy catalogSources', () => {
    const modern = { provider: 'TMDB', tmdbSourceType: 'DISCOVER', mediaType: 'TV', filters: { withOriginalLanguage: 'ja', voteCountGte: 100 } }
    const result = parse({ ...collection, folders: [{ ...collection.folders[0], sources: [modern] }] })
    expect(result.collections[0].folders[0].sources).toEqual([expect.objectContaining({ provider: 'tmdb', mediaType: 'tv', filters: modern.filters })])
  })
  it('retains supplied requirements without inventing or installing any', () => {
    const result = parse({ collection, requirements: { addons: [{ addonId: 'test.addon', manifestUrl: 'https://addon.test/config/manifest.json', requiredCatalogs: [{ type: 'movie', id: 'list-123' }] }] } })
    expect(result.requirements[0]).toMatchObject({ manifestUrl: 'https://addon.test/config/manifest.json', requiredCatalogs: [{ type: 'movie', catalogId: 'list-123' }] })
    expect(parse([collection]).requirements).toEqual([])
  })
  it('updates matching IDs without deleting unrelated collections or creating duplicates', () => {
    const current = parse([collection, { ...collection, id: 'second' }]).collections
    const incoming = parse([{ ...collection, title: 'Updated' }]).collections
    expect(mergeCollectionImports(current, incoming).map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'services', title: 'Updated' }, { id: 'second', title: 'Streaming services' },
    ])
    expect(current[0].title).toBe('Streaming services')
  })
  it('rejects malformed, duplicate and unrelated input before any import', () => {
    expect(() => parse([collection, collection])).toThrow('Duplicate collection')
    expect(() => parse({ ...collection, folders: [collection.folders[0], collection.folders[0]] })).toThrow('Duplicate folder')
    expect(() => parse({ id: 'aiometadata', name: 'Add-on config' })).toThrow()
    expect(() => parse({ ...collection, folders: [{ id: 'x', title: 'Invalid', sources: [{ provider: 'addon' }] }] })).toThrow('addonId')
    expect(() => parseCollectionImport('invalid')).toThrow('valid collection JSON')
  })
  it('rejects invalid identifiers and structured filters without silently dropping constraints', () => {
    for (const item of [
      { provider: 'trakt', traktListId: -2 },
      { provider: 'tmdb', tmdbSourceType: 'LIST', tmdbId: '1/../../account' },
      { provider: 'tmdb', tmdbSourceType: 'DISCOVER', filters: { withGenres: [28] } },
    ]) expect(() => parse({ ...collection, folders: [{ id: 'x', title: 'Invalid', sources: [item] }] })).toThrow()
  })
  it('accepts raw remote artwork and rejects executable or credential-bearing URLs', () => {
    expect(collectionImageUrl('https://images.test/a.png?token=public')).toBe('https://images.test/a.png?token=public')
    for (const url of ['javascript:alert(1)', 'file:///secret', 'data:image/svg+xml,x', 'https://user:password@images.test/a']) expect(collectionImageUrl(url)).toBeUndefined()
    expect(collectionFolderHref('a&b', '../folder?x')).toBe('/app/collections?collection=a%26b&folder=..%2Ffolder%3Fx')
  })
  it('routes collection JSON away from the playback source installer', () => {
    expect(isCollectionDocument([collection])).toBe(true)
    expect(classifySourceDocument([collection], 'https://example.test/collections.json')).toEqual({ error: 'This is a collection. Import it in Settings → Catalog → Collections.' })
    expect(isCollectionDocument({ scrapers: [] })).toBe(false)
  })
})
