import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Discovery Queue UI', () => {
  it('supports touch, mouse, keyboard and explicit accessible actions', () => {
    expect(page).toContain('onpointerdown={pointerDown}')
    expect(page).toContain("event.key.toLowerCase() === 'n'")
    expect(page).toContain("event.key.toLowerCase() === 's'")
    expect(page).not.toContain('<svelte:window onkeydown')
    expect(page).toContain("decide('dismiss')")
    expect(page).toContain("decide('skip')")
    expect(page).toContain("decide('save')")
    expect(page).toContain('aria-live="polite"')
  })

  it('keeps discovery in Library, off both home layouts', () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    expect(page).toContain('<LibraryNav />')
    expect(read('../home/+page.svelte')).not.toContain('DiscoveryQueueCta')
    expect(read('../../../lib/components/library/LibraryNav.svelte')).toContain("href: '/app/discovery-queue', label: 'Discover'")
    for (const name of ['CatalogHome', 'MergedCatalogHome']) {
      expect(read(`../../../lib/components/catalog/${name}.svelte`)).not.toContain('DiscoveryQueueCta')
    }
  })

  it('cancels gestures without recording choices and ignores stale loads', () => {
    expect(page).toContain('onpointercancel={pointerCancel}')
    expect(page).not.toContain('onpointercancel={pointerEnd}')
    expect(page).toContain('abort.signal.aborted || loadAbort !== abort')
    expect(page).toContain('restoredKey = mediaKey(previous.media)')
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
