import { describe, expect, it } from 'vitest'
import { onboardingCatalogPlan, onboardingSteps } from './onboarding'
import { resolveCatalogScreenStartup } from './catalog'

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
    expect(onboardingSteps('anime')).toEqual([0, 1, 2, 6, 7])
    expect(onboardingSteps('movies')).toEqual([0, 1, 2, 3, 4, 6, 7])
    expect(onboardingSteps('both')).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it.each(['auto', 'merged', 'movies'] as const)('opens the chosen %s library regardless of the last library', startup => {
    const plan = onboardingCatalogPlan('both', 'tmdb', startup)
    const expected = startup === 'movies' ? 'tmdb' : startup
    expect(plan.providers).toEqual(['auto', 'tmdb'])
    for (const last of ['auto', 'tmdb', 'merged']) {
      expect(resolveCatalogScreenStartup(plan.defaultProvider, last, plan.providers)).toBe(expected)
    }
  })

  it.each(['auto', 'tmdb', 'merged'] as const)('remembers %s when Both uses Adaptive', last => {
    const plan = onboardingCatalogPlan('both', 'tmdb', 'adaptive')
    expect(plan.defaultProvider).toBe('adaptive')
    expect(resolveCatalogScreenStartup(plan.defaultProvider, last, plan.providers)).toBe(last)
  })

  it('falls back to an enabled library when Adaptive remembers an unavailable catalog', () => {
    const plan = onboardingCatalogPlan('both', 'tmdb', 'adaptive')
    expect(resolveCatalogScreenStartup(plan.defaultProvider, 'kitsu', plan.providers)).toBe('auto')
  })

  it('keeps the movie startup choice aligned when metadata changes to Stremio', () => {
    const plan = onboardingCatalogPlan('both', 'stremio', 'movies')
    expect(plan).toEqual({ providers: ['auto', 'stremio'], defaultProvider: 'stremio' })
    expect(resolveCatalogScreenStartup(plan.defaultProvider, 'tmdb', plan.providers)).toBe('stremio')
  })

  it('ignores the Both-only startup choice after switching to a single library', () => {
    expect(onboardingCatalogPlan('anime', 'tmdb', 'adaptive').defaultProvider).toBe('auto')
    expect(onboardingCatalogPlan('movies', 'tmdb', 'merged').defaultProvider).toBe('tmdb')
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
