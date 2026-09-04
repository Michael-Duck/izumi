import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('native Letterboxd hub', () => {
  it('supports live RSS, official ZIP/CSV imports, and TMDB matching', () => {
    expect(page).toContain('fetchLetterboxdFeed')
    expect(page).toContain('readLetterboxdImport(file)')
    expect(page).toContain('resolveLetterboxdRecords')
    expect(page).toContain('accept=".zip,.csv')
  })

  it('shows cached-feed, progress, empty, and failure states', () => {
    expect(page).toContain('Showing the last saved feed.')
    expect(page).toContain('resolveProgress.completed')
    expect(page).toContain('No film diary entries were found')
    expect(page).toContain('role="alert"')
  })

  it('keeps Letterboxd links explicit while cards use TMDB detail routes', () => {
    expect(page).toContain('Open on Letterboxd')
    expect(page).toContain('the same source Letterboxd uses')
  })
})
