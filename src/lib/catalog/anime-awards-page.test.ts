import { describe, expect, it } from 'vitest'
import { ANIME_AWARD_WINNERS, animeAwardCategories, animeAwardHref, animeAwardYears } from './anime-awards'

describe('anime award discovery', () => {
  it('orders ceremony years newest first and keeps headline categories first', () => {
    expect(animeAwardYears()[0]).toBe(Math.max(...ANIME_AWARD_WINNERS.map((winner) => winner.year)))
    expect(animeAwardCategories(2026)[0]).toBe('Anime of the Year')
  })

  it('builds a deep link to the exact year and category', () => {
    const href = animeAwardHref({ year: 2026, category: 'Best Animation', title: 'Example' })
    expect(href).toBe('/app/awards/crunchyroll?year=2026&category=Best+Animation')
  })
})
