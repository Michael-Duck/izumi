import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Discovery Queue UI', () => {
  it('supports touch, mouse, keyboard and explicit accessible actions', () => {
    expect(page).toContain('onpointerdown={pointerDown}')
    expect(page).toContain("event.key === 'ArrowLeft'")
    expect(page).toContain("event.key === 'ArrowRight'")
    expect(page).toContain("decide('dismiss')")
    expect(page).toContain("decide('skip')")
    expect(page).toContain("decide('save')")
    expect(page).toContain('aria-live="polite"')
  })

  it('has loading, error, offline, empty and configuration states', () => {
    expect(page).toContain('$offlineMode')
    expect(page).toContain('{:else if loading}')
    expect(page).toContain('{:else if error && !pool.length}')
    expect(page).toContain('needsConfiguration')
    expect(page).toContain('You’re caught up')
  })

  it('keeps save and undo tied to the profile-local watchlist and feedback stores', () => {
    expect(page).toContain('setMediaInLocalList(media, WATCHLIST_ID, true)')
    expect(page).toContain('recordDiscoveryDecision(media, action)')
    expect(page).toContain('forgetDiscoveryDecision(previous.media)')
  })
})
