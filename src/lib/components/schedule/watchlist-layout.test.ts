import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('./WatchlistView.svelte', import.meta.url)),
  'utf8',
)

describe('watchlist progress layout', () => {
  it('offers a labelled full-width progress-list view with landscape artwork', () => {
    expect(source).toContain("{ value: 'list', label: 'Progress list', icon: Rows3 }")
    expect(source).toContain('rowArtwork(it)')
    expect(source).toContain('Continue watching →')
    expect(source).toContain('role="progressbar"')
  })

  it('distinguishes watched and available progress with quiet neutral tones', () => {
    expect(source).toContain('bg-foreground/45 transition-[width]')
    expect(source).toContain('bg-foreground/15 transition-[left,width]')
    expect(source).not.toContain('bg-primary')
  })
})
