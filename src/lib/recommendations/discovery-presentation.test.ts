import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { discoveryFacts, discoveryKind, discoveryTrailerId, discoveryWindow } from './discovery-presentation'

const media = (extra: Partial<Media> = {}): Media => ({ id: 1, title: { english: 'A title' }, ...extra })

describe('discovery presentation', () => {
  it('distinguishes a film running time from episode counts and episode duration', () => {
    expect(discoveryFacts(media({ type: 'MOVIE', duration: 155, episodes: 1, startDate: { year: 2021 }, contentRating: '12' })))
      .toEqual(['Movie', '2021', '2h 35m', '12'])
    expect(discoveryFacts(media({ type: 'SERIES', duration: 45, episodes: 9, seasonYear: 2022 })))
      .toEqual(['Series', '2022', '9 episodes', '45 min / ep'])
    expect(discoveryFacts(media({ format: 'MOVIE', duration: 120 }))).toEqual(['Movie', '2h'])
  })

  it('omits unavailable facts and keeps tile information concise', () => {
    expect(discoveryFacts(media())).toEqual([])
    expect(discoveryFacts(media({ duration: -1, episodes: 0 }))).toEqual([])
    expect(discoveryFacts(media({ format: 'TV', startDate: { year: 2024 }, duration: 24, episodes: 12 }), true))
      .toEqual(['Anime series', '2024'])
    expect(discoveryKind(media({ catalog: { provider: 'tmdb', type: 'series', id: '1' } }))).toBe('Series')
  })

  it('accepts supported trailers with optional site metadata and rejects malformed IDs', () => {
    expect(discoveryTrailerId(media({ trailer: { id: '8g18jFHCLXk' } }))).toBe('8g18jFHCLXk')
    expect(discoveryTrailerId(media({ trailer: { id: '8g18jFHCLXk', site: 'YouTube' } }))).toBe('8g18jFHCLXk')
    expect(discoveryTrailerId(media({ trailer: { id: '8g18jFHCLXk', site: 'unsupported' } }))).toBeUndefined()
    expect(discoveryTrailerId(media({ trailer: { id: '../bad?id=1' } }))).toBeUndefined()
    expect(discoveryTrailerId()).toBeUndefined()
  })

  it('keeps the selected pick in a bounded group, including the final partial group', () => {
    const items = Array.from({ length: 12 }, (_, index) => index)
    expect(discoveryWindow(items, 4)).toEqual({ start: 0, items: [0, 1, 2, 3, 4] })
    expect(discoveryWindow(items, 5)).toEqual({ start: 5, items: [5, 6, 7, 8, 9] })
    expect(discoveryWindow(items, 11)).toEqual({ start: 10, items: [10, 11] })
    expect(discoveryWindow([], 0)).toEqual({ start: 0, items: [] })
  })
})
