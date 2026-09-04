import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('navigation destinations', () => {
  it('shares watchlists with Library without restoring the obsolete mylist route', () => {
    const sidebar = read('./Sidebar.svelte')
    const nav = read('../../settings/nav.ts')
    const myListRoute = fileURLToPath(new URL('../../../routes/app/mylist/+page.svelte', import.meta.url))

    expect(sidebar).not.toContain('/app/mylist')
    expect(nav).not.toContain("id: 'mylist'")
    expect(existsSync(myListRoute)).toBe(false)
  })

  it('does not label tracker state as a card catalogue source', () => {
    const card = read('../cards/SmallCard.svelte')
    expect(card).not.toContain('sourceLabel')
    expect(card).not.toContain('View on ${sourceLabel}')
  })

  it('makes the native Trakt hub reachable on desktop and configurable on mobile', () => {
    const sidebar = read('./Sidebar.svelte')
    const nav = read('../../settings/nav.ts')
    expect(sidebar).toContain("href: '/app/library'")
    expect(sidebar).not.toContain("href: '/app/trakt'")
    expect(read('../library/LibraryNav.svelte')).toContain("href: '/app/trakt'")
    expect(nav).toContain("trakt: { label: 'Trakt', href: '/app/trakt'")
    expect(nav).toContain("{ id: 'trakt', placement: 'hidden' }")
  })

  it('makes the Letterboxd import and diary hub reachable without crowding the default mobile bar', () => {
    const sidebar = read('./Sidebar.svelte')
    const nav = read('../../settings/nav.ts')
    expect(sidebar).not.toContain("href: '/app/letterboxd'")
    expect(read('../library/LibraryNav.svelte')).toContain("href: '/app/letterboxd'")
    expect(nav).toContain("letterboxd: { label: 'Letterboxd', href: '/app/letterboxd'")
    expect(nav).toContain("{ id: 'letterboxd', placement: 'hidden' }")
  })
})
