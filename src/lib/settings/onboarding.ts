import { persisted } from 'svelte-persisted-store'
import type { CatalogSelection, CatalogDefaultSelection } from './catalog'

export type OnboardingFocus = 'anime' | 'movies' | 'both'
export type OnboardingMovieMetadata = 'tmdb' | 'stremio'
export type OnboardingStartupLibrary = 'movies' | 'auto' | 'merged' | 'adaptive'

export interface OnboardingCatalogPlan {
  providers: CatalogSelection[]
  defaultProvider: CatalogDefaultSelection
}

/** Convert the first-run intent into the same catalog settings used by the rest of Izumi. Keeping
 * this pure makes rerunning the assistant predictable and prevents a second onboarding-only config. */
export function onboardingCatalogPlan(
  focus: OnboardingFocus,
  movieMetadata: OnboardingMovieMetadata = 'tmdb',
  startupLibrary: OnboardingStartupLibrary = 'merged',
): OnboardingCatalogPlan {
  if (focus === 'both') return {
    providers: ['auto', movieMetadata],
    defaultProvider: startupLibrary === 'movies' ? movieMetadata : startupLibrary,
  }
  const defaultProvider: CatalogSelection = focus === 'anime' ? 'auto' : movieMetadata
  return { providers: [defaultProvider], defaultProvider }
}

export function onboardingSteps(focus: OnboardingFocus): number[] {
  // Stremio source sync is optional for every catalog, including anime.
  if (focus === 'anime') return [0, 1, 2, 6, 7]
  return focus === 'both' ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 6, 7]
}

/** Versioned so a future materially different setup flow can be offered without losing history. */
export const onboardingComplete = persisted<boolean>('onboarding-complete-v1', false)

export function finishOnboarding(): void {
  onboardingComplete.set(true)
}

export function restartOnboarding(): void {
  onboardingComplete.set(false)
}
