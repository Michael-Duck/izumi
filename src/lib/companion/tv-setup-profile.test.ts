import { beforeEach, expect, it, vi } from 'vitest'
import { currentTvSetupProfile } from './tv-setup-profile'
import { addonUrls, disabledSources } from '$lib/stremio/sources'
import { debridKey, preferredQuality } from '$lib/settings/ui'

vi.mock('$lib/settings/catalog', async () => {
  const { writable } = await import('svelte/store')
  return { catalogScreen: writable('merged'), enabledCatalogScreens: writable(['kitsu', 'tmdb', 'merged']), tmdbReadToken: writable(' test-tmdb-token ') }
})
vi.mock('$lib/settings/ui', async () => {
  const { writable } = await import('svelte/store')
  return {
    debridKey: writable(' test-debrid-key '), debridProvider: writable('torbox'), hideSpoilers: writable(false),
    preferredAudioLang: writable('eng'), preferredQuality: writable('2160'), preferredStreamSort: writable('size'), showAdult: writable(true),
  }
})
beforeEach(() => {
  addonUrls.set(['https://enabled.example/configuration', 'https://disabled.example'])
  disabledSources.set(['https://disabled.example'])
  debridKey.set(' test-debrid-key ')
  preferredQuality.set('2160')
})
it('copies the active source and TV settings without unrelated account or household data', () => {
  expect(currentTvSetupProfile()).toEqual({
    protocol: 1, addons: ['https://enabled.example/configuration'], quality: '2160', sort: 'size', audioLang: 'eng',
    debrid: { provider: 'torbox', credential: 'test-debrid-key' },
    catalog: { screens: ['kitsu', 'tmdb', 'merged'], defaultScreen: 'merged', showAdult: true, hideSpoilers: false, tmdbToken: 'test-tmdb-token' },
  })
})
it('reads current preferences on each request and never invents sources or debrid credentials', () => {
  const first = currentTvSetupProfile()
  first.addons.push('https://not-saved.example')
  preferredQuality.set('480')
  disabledSources.set(['https://enabled.example/configuration', 'https://disabled.example'])
  debridKey.set('')
  expect(currentTvSetupProfile()).toMatchObject({ addons: [], quality: '480', debrid: null })
})
