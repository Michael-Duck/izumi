import { expect, it, vi } from 'vitest'
import { createNuvioApi, normalizeNuvioItem, prepareNuvioImport, type BrowseOptions } from './api'
import { parseCollectionImport } from '$lib/catalog/collections/model'
import { nuvioClient } from './auth'
import { fetchManifest } from '$lib/stremio/manifest'
vi.mock('$lib/stremio/manifest', () => ({ fetchManifest: vi.fn() }))
const options: BrowseOptions = { page: 2, search: ' studio ghibli ', sort: 'popular', type: 'collection_pack', orientation: 'portrait', format: 'gif' }
const collection = { id: 'creator-id', title: 'Studio nights', folders: [{ id: 'films', title: 'Films', sources: [{ provider: 'addon', addonId: 'studio', type: 'movie', catalogId: 'all' }] }] }
function setup() {
  const request = vi.fn()
  return { request, api: createNuvioApi({ ...nuvioClient, request }) }
}
it('uses the website gallery filters and pagination contract', async () => {
  const { request, api } = setup()
  request.mockResolvedValue({ items: [{ id: 12, title: 'Cover', image_url: 'https://art.test/cover.gif', orientation: 'portrait' }], pagination: { hasNextPage: true } })
  const result = await api.browse('cover', options)
  const url = new URL(request.mock.calls[0][1], 'https://nuvio.tv')
  expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', limit: '24', sort: 'popular', search: 'studio ghibli', orientation: 'portrait', format: 'gif' })
  expect(result).toMatchObject({ hasNext: true, items: [{ id: '12', portrait: true, animated: true }] })
  expect(url.searchParams.has('type')).toBe(false)
})
it('loads the detail envelope and keeps dependencies for the import preview', async () => {
  const { request, api } = setup()
  request.mockResolvedValue({ item: { envelope: { collection, requirements: { addons: [{ addonId: 'studio', manifestUrl: 'https://studio.test/manifest.json' }] } } } })
  const result = await api.community('cinema/night')
  expect(request.mock.calls[0][1]).toBe('/api/community-collections/cinema%2Fnight')
  expect(result.requirements[0].manifestUrl).toBe('https://studio.test/manifest.json')
  expect(result.collections[0].nuvioOrigin).toBe('community:cinema/night')
})
it('namespaces creator and account IDs while keeping repeat imports stable', async () => {
  const one = await prepareNuvioImport([collection], 'community:one')
  const repeat = await prepareNuvioImport([collection], 'community:one')
  const other = await prepareNuvioImport([collection], 'community:two')
  expect(one.collections[0].id).toBe(repeat.collections[0].id)
  expect(one.collections[0].id).not.toBe(other.collections[0].id)
  expect(parseCollectionImport(JSON.stringify(one.collections)).collections[0].nuvioOrigin).toBe('community:one')
})
it('keeps profile reads scoped to the selected profile and accepts an empty account', async () => {
  const { request, api } = setup()
  request.mockResolvedValueOnce([{ profile_index: 3, name: 'Weekend', uses_primary_addons: true }]).mockResolvedValueOnce([{ collections_json: [] }])
  const profiles = await api.profiles()
  expect(await api.profileCollections(profiles[0], 'user-one')).toEqual([])
  expect(request.mock.calls[1]).toEqual(['backend', '/rest/v1/rpc/sync_pull_collections', { p_profile_id: 3 }, undefined])
})
it('treats a profile with no collections sync row as empty', async () => {
  const { request, api } = setup()
  request.mockResolvedValue([])
  expect(await api.profileCollections({ id: 1, name: 'New profile', usesPrimaryAddons: false }, 'new-user')).toEqual([])
})
it('finds matching enabled profile sources, honoring inheritance and legacy catalog IDs', async () => {
  const { request, api } = setup()
  request.mockResolvedValueOnce([{ url: 'https://studio.test/manifest.json' }, { url: 'https://disabled.test/manifest.json', enabled: false }])
  vi.mocked(fetchManifest).mockResolvedValue({ id: 'studio', name: 'Studio', version: '1', catalogs: [{ id: 'all', type: 'movie', name: 'All films' }] })
  const imported = await prepareNuvioImport([collection], 'profile:one:3')
  imported.collections[0].folders[0].sources[0].catalogId = 'all,legacy'
  const result = await api.profileRequirements(imported.collections, { id: 3, name: 'Weekend', usesPrimaryAddons: true })
  expect(new URL(request.mock.calls[0][1], 'https://api.nuvio.tv').searchParams.get('profile_id')).toBe('eq.1')
  expect(request).toHaveBeenCalledTimes(1)
  expect(result[0]).toMatchObject({ addonId: 'studio', requiredCatalogs: [{ type: 'movie', catalogId: 'all' }] })
  expect(fetchManifest).toHaveBeenCalledTimes(1)
})
it('excludes unsafe artwork URLs and handles galleries with unavailable images', () => {
  expect(normalizeNuvioItem({ public_id: 'one', image_url: 'javascript:alert(1)', title: 'One' }, 'collection')?.imageUrl).toBeUndefined()
  expect(normalizeNuvioItem({}, 'collection')).toBeNull()
})
