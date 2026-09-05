import { describe, expect, it } from 'vitest'
import { onboardingCatalogPlan, onboardingSteps } from './onboarding'

describe('first-run catalog profile', () => {
  it('starts an anime-focused client on Automatic anime', () => {
    expect(onboardingCatalogPlan('anime')).toEqual({
      providers: ['auto'],
      defaultProvider: 'auto',
    })
  })

  it.each(['tmdb', 'stremio'] as const)('enables anime alongside %s in a merged home', metadata => {
    expect(onboardingCatalogPlan('both', metadata)).toEqual({ providers: ['auto', metadata], defaultProvider: 'merged' })
  })

  it('only asks about film metadata and access when they are relevant', () => {
    expect(onboardingSteps('anime')).toEqual([0, 1, 2, 5, 6])
    expect(onboardingSteps('movies')).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(onboardingSteps('both')).toEqual(onboardingSteps('movies'))
  })

  it('recommends TMDB for a movie and TV-focused client', () => {
    expect(onboardingCatalogPlan('movies')).toEqual({
      providers: ['tmdb'],
      defaultProvider: 'tmdb',
    })
  })

  it('can deliberately choose the more limited Stremio metadata path', () => {
    expect(onboardingCatalogPlan('movies', 'stremio')).toEqual({
      providers: ['stremio'],
      defaultProvider: 'stremio',
    })
  })
})
