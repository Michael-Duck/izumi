import { get } from 'svelte/store'
import { catalogScreen, enabledCatalogScreens, tmdbReadToken } from '$lib/settings/catalog'
import { debridKey, debridProvider, hideSpoilers, preferredAudioLang, preferredQuality, preferredStreamSort, showAdult } from '$lib/settings/ui'
import { enabledAddonUrls } from '$lib/stremio/sources'

/** Only settings needed by the TV wizard. Never include account sessions, sync keys or household data. */
export function currentTvSetupProfile() {
  const credential = get(debridKey).trim()
  const provider = get(debridProvider)
  return {
    protocol: 1 as const,
    addons: [...get(enabledAddonUrls)],
    quality: get(preferredQuality),
    sort: get(preferredStreamSort),
    audioLang: get(preferredAudioLang),
    debrid: provider && credential ? { provider, credential } : null,
    catalog: {
      screens: [...get(enabledCatalogScreens)],
      defaultScreen: get(catalogScreen),
      showAdult: get(showAdult),
      hideSpoilers: get(hideSpoilers),
      tmdbToken: get(tmdbReadToken).trim(),
    },
  }
}
