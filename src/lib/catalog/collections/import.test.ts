import { beforeEach, expect, it, vi } from 'vitest'
import { phttp } from '$lib/net/http'
import { fetchManifest } from '$lib/stremio/manifest'
import { readCollectionImport, validateCollectionDependencies } from './import'
vi.mock('$lib/net/http', () => ({ phttp: vi.fn() }))
vi.mock('$lib/stremio/manifest', () => ({ fetchManifest: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('explains the authenticated Nuvio export flow without trying to access the account API', async () => {
  await expect(readCollectionImport('https://nuvio.tv/community-collections/quick-dial')).rejects.toThrow('Account → Collections → Export')
  expect(phttp).not.toHaveBeenCalled()
})
it('downloads direct collection JSON with cancellation and a size limit', async () => {
  vi.mocked(phttp).mockResolvedValue(new Response('[{"id":"one","title":"One","folders":[]}]'))
  const abort = new AbortController()
  expect((await readCollectionImport('https://creator.test/collection.json', abort.signal)).collections[0].id).toBe('one')
  expect(phttp).toHaveBeenCalledWith('https://creator.test/collection.json', expect.objectContaining({ signal: abort.signal, maxBytes: 8 * 1024 * 1024 }))
})
it('requires matching add-on identity and catalogs before dependency installation', async () => {
  const requirements = [{ addonId: 'one', addonName: 'One', manifestUrl: 'https://addon.test/manifest.json', requiredCatalogs: [{ type: 'movie', catalogId: 'wanted' }] }]
  vi.mocked(fetchManifest).mockResolvedValue({ id: 'one', name: 'One', version: '1', catalogs: [] })
  await expect(validateCollectionDependencies(requirements)).rejects.toThrow('missing movie / wanted')
  vi.mocked(fetchManifest).mockResolvedValue({ id: 'one', name: 'One', version: '1', catalogs: [{ id: 'wanted', type: 'movie', name: 'Wanted' }] })
  expect(await validateCollectionDependencies(requirements)).toEqual(['https://addon.test'])
})
