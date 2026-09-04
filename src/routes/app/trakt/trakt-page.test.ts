import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('native Trakt hub', () => {
  it('has setup, loading, partial-error, empty, and populated states', () => {
    expect(page).toContain('Connect Trakt first')
    expect(page).toContain('skeletonRow')
    expect(page).toContain('sectionError(section)')
    expect(page).toContain('Your Trakt Watchlist is empty.')
    expect(page).toContain("mediaRow('Movies for you'")
  })

  it('supports native recommendation hiding and Watchlist removal', () => {
    expect(page).toContain('hideTraktRecommendation(item)')
    expect(page).toContain('setTraktWatchlist(item.media, false)')
    expect(page).toContain('Hide recommendation')
    expect(page).toContain('Remove from Watchlist')
  })

  it('exposes accessible refresh and failure recovery controls', () => {
    expect(page).toContain('aria-busy={loading}')
    expect(page).toContain('role="alert"')
    expect(page).toContain('Try again')
  })
})
