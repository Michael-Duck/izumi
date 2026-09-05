export type ListProviderId = 'trakt'

export interface ListProvider {
  id: ListProviderId
  name: string
  description: string
  addonId: string
  base: string
  configureUrl: string
  accent: string
  initials: string
}

/** Legacy list add-on metadata used to label already-installed catalogs, not account setup. */
export const LIST_PROVIDERS: readonly ListProvider[] = [
  {
    id: 'trakt',
    name: 'Trakt',
    description: 'Watchlist, recommendations, history, and personal or public lists.',
    addonId: 'community.trakt-tv',
    base: 'https://2ecbbd610840-trakt.baby-beamup.club',
    configureUrl: 'https://2ecbbd610840-trakt.baby-beamup.club/configure/',
    accent: 'bg-[#ed1c24]/15 text-[#ff4f56]',
    initials: 'T',
  },
] as const

export function listProviderByAddonId(addonId: string): ListProvider | undefined {
  return LIST_PROVIDERS.find((provider) => provider.addonId === addonId)
}

/** Recognize an existing configured URL even before its manifest has loaded. Configured variants
 * keep the public add-on's origin and put the private configuration in the path/query. */
export function listProviderOwnsUrl(provider: ListProvider, value: string): boolean {
  try {
    return new URL(value).origin === new URL(provider.base).origin
  } catch {
    return false
  }
}
