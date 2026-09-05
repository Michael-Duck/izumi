import { persisted } from 'svelte-persisted-store'
import type { CatalogSelection, CatalogScreen } from './catalog'

export type OnboardingFocus = 'anime' | 'movies' | 'both'
export type OnboardingMovieMetadata = 'tmdb' | 'stremio'

export interface OnboardingCatalogPlan {
  providers: CatalogSelection[]
  defaultProvider: CatalogScreen
}

/** Convert the first-run intent into the same catalog settings used by the rest of Izumi. Keeping
 * this pure makes rerunning the assistant predictable and prevents a second onboarding-only config. */
export function onboardingCatalogPlan(
  focus: OnboardingFocus,
  movieMetadata: OnboardingMovieMetadata = 'tmdb',
): OnboardingCatalogPlan {
  if (focus === 'both') return { providers: ['auto', movieMetadata], defaultProvider: 'merged' }
  const defaultProvider: CatalogSelection = focus === 'anime' ? 'auto' : movieMetadata
  return { providers: [defaultProvider], defaultProvider }
}

export function onboardingSteps(focus: OnboardingFocus): number[] {
  return focus === 'anime' ? [0, 1, 4, 5] : [0, 1, 2, 3, 4, 5]
}

/** Versioned so a future materially different setup flow can be offered without losing history. */
export const onboardingComplete = persisted<boolean>('onboarding-complete-v1', false)

export function finishOnboarding(): void {
  onboardingComplete.set(true)
}

export function restartOnboarding(): void {
  onboardingComplete.set(false)
}
