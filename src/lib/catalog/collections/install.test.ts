import { beforeEach, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { installCollectionImport } from './install'
import { homeCollections } from './store'
import { addonUrls, disabledSources } from '$lib/stremio/sources'
import { validateCollectionDependencies } from './import'
import { parseCollectionImport } from './model'
vi.mock('./import', () => ({ validateCollectionDependencies: vi.fn() }))
const pending = parseCollectionImport('[{"id":"new","title":"New","folders":[]}]')
beforeEach(() => { homeCollections.set([]); addonUrls.set(['https://old.test']); disabledSources.set(['https://old.test']); vi.mocked(validateCollectionDependencies).mockReset() })
it('leaves settings untouched when a selected dependency cannot be verified', async () => {
  vi.mocked(validateCollectionDependencies).mockRejectedValue(new Error('Missing catalog'))
  await expect(installCollectionImport(pending, [0])).rejects.toThrow('Missing catalog')
  expect(get(homeCollections)).toEqual([])
  expect(get(addonUrls)).toEqual(['https://old.test'])
  expect(get(disabledSources)).toEqual(['https://old.test'])
})
it('does not install after the preview is closed during dependency validation', async () => {
  const abort = new AbortController()
  vi.mocked(validateCollectionDependencies).mockImplementation(async () => { abort.abort(); return ['https://new.test'] })
  await expect(installCollectionImport(pending, [], abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(get(homeCollections)).toEqual([])
  expect(get(addonUrls)).toEqual(['https://old.test'])
})
it('adds once and enables only explicitly selected dependencies', async () => {
  vi.mocked(validateCollectionDependencies).mockResolvedValue(['https://new.test'])
  await installCollectionImport(pending, [])
  await installCollectionImport(pending, [])
  expect(get(homeCollections)).toHaveLength(1)
  expect(get(addonUrls)).toEqual(['https://old.test', 'https://new.test'])
  expect(get(disabledSources)).toEqual(['https://old.test'])
})
