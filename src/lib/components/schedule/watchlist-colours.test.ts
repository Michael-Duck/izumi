import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const source = readFileSync(new URL('./WatchlistView.svelte', import.meta.url), 'utf8')
describe('calm library progress', () => {
  it('uses neutral progress and layout selection instead of repeated brand-colour fills', () => {
    expect(source).toContain('bg-foreground/45 transition-[width]')
    expect(source).toContain('bg-foreground/15 transition-[left,width]')
    expect(source).not.toContain('bg-theme transition-[width]')
    expect(source).not.toContain("? 'bg-theme text-white'")
    expect(source).toContain('aria-valuenow={it.progress}')
  })
})
