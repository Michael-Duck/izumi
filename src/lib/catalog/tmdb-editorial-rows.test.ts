import { describe, expect, it } from 'vitest'
import { tmdbEditorialRows } from './providers/tmdb'

describe('TMDB editorial rails', () => {
  it('selects every requested editorial family', () => {
    expect(tmdbEditorialRows(new Date('2026-09-04T20:00:00Z')).map((row) => row.id))
      .toEqual(['critics-pick', 'mood-now', 'world-cinema', 'network-spotlight'])
  })

  it('is stable within a viewing period and rotates across dates', () => {
    const first = tmdbEditorialRows(new Date('2026-09-04T20:00:00Z'))
    const same = tmdbEditorialRows(new Date('2026-09-04T20:30:00Z'))
    const next = tmdbEditorialRows(new Date('2026-09-05T20:00:00Z'))
    expect(same.map((row) => row.title)).toEqual(first.map((row) => row.title))
    expect(next.slice(1).map((row) => row.title)).not.toEqual(first.slice(1).map((row) => row.title))
  })

  it('uses provider-native language and network filters', () => {
    const rows = tmdbEditorialRows(new Date('2026-09-04T20:00:00Z'))
    expect(rows.find((row) => row.id === 'world-cinema')?.params).toHaveProperty('with_original_language')
    expect(rows.find((row) => row.id === 'network-spotlight')?.params).toHaveProperty('with_networks')
  })
})
