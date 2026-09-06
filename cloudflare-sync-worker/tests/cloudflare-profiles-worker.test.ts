import { describe, expect, it } from 'vitest'
import { normalizeHousehold, scopeSnapshot, validSnapshotSelector, viewerAllows, viewerForRequest } from '../src/profiles.js'
import { catalogInternals } from '../src/catalog.js'
import type { IzumiProfile } from '$lib/profiles/store'
import type { CompanionHomeSnapshot, CompanionMedia } from '$lib/companion/protocol'

const child: IzumiProfile = { id: 'child', name: 'Mina', color: '#457b9d', createdAt: 1, ratingLimit: 12, allowAdult: false }
const media = (title: string, contentRating: string): CompanionMedia => ({ title, contentRating, ref: { provider: 'tmdb', type: 'movie', id: title } })

describe('Worker household isolation', () => {
  it('accepts bounded profile selectors and legacy catalogue names', () => {
    for (const key of ['tmdb', 'default~anilist', 'child~tmdb']) expect(validSnapshotSelector(key)).toBe(true)
    for (const key of ['../child~tmdb', 'a~b~tmdb', 'child~unknown', 'x'.repeat(101) + '~tmdb']) expect(validSnapshotSelector(key)).toBe(false)
  })
  it('does not copy account tokens or silently remove a malformed PIN', () => {
    const result = normalizeHousehold({ enabled: true, profiles: [{ ...child, traktToken: 'private' }] })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(() => normalizeHousehold({ profiles: [{ ...child, pin: { hash: 'broken', salt: 'broken' } }] })).toThrow('PIN')
  })
  it('requires an explicit known viewer whenever profiles are enabled', async () => {
    const config = { household: { enabled: true, profiles: [child] }, catalog: { showAdult: true } }
    await expect(viewerForRequest(config, {})).rejects.toThrow('Choose')
    await expect(viewerForRequest(config, { profileId: 'default' })).rejects.toThrow('Choose')
    expect(await viewerForRequest(config, { profileId: 'child' })).toEqual(child)
    expect(config.catalog.showAdult).toBe(false)
  })
  it('verifies PINs without storing the PIN in the resolver profile', async () => {
    const salt = 'ab'.repeat(16)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':1234'))
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const profile = { ...child, pin: { salt, hash } }
    const config = { household: { enabled: true, profiles: [profile] }, catalog: { showAdult: false } }
    await expect(viewerForRequest(config, { profileId: 'child' })).rejects.toThrow('Unlock')
    await expect(viewerForRequest(config, { profileId: 'child', profilePin: '0000' })).rejects.toThrow('incorrect')
    expect(await viewerForRequest(config, { profileId: 'child', profilePin: '1234' })).toEqual(profile)
    expect(JSON.stringify(config)).not.toContain('profilePin')
  })
  it('filters every snapshot collection, including history and navigation views', () => {
    const allowed = media('Family', 'PG'), blocked = media('Mature', 'TV-MA')
    const snapshot: CompanionHomeSnapshot = { app: 'izumi', kind: 'companion-home', version: 1, revision: '1', generatedAt: 1, catalog: { screen: 'tmdb', label: 'Movies' }, hero: blocked, rows: [{ id: 'a', title: 'Films', kind: 'catalog', items: [allowed, blocked] }], history: [blocked], views: { myList: [allowed, blocked] } }
    const result = scopeSnapshot(snapshot, { household: { enabled: true, profiles: [child] }, catalog: { showAdult: false } }, child)!
    expect(result.profileId).toBe('child')
    expect(result.hero).toEqual(allowed)
    expect(result.history).toEqual([])
    expect(result.views?.myList).toEqual([allowed])
    expect(viewerAllows({ isAdult: true }, child)).toBe(false)
  })
  it('preserves provider parental metadata at the compact media boundary', async () => {
    const detail = await catalogInternals.aniDetail('1', async () => new Response(JSON.stringify({ data: { Media: { id: 1, title: { english: 'Test' }, isAdult: true } } })))
    expect(detail?.summary.isAdult).toBe(true)
    expect(catalogInternals.kitsuMedia({ id: 1, attributes: { canonicalTitle: 'Test', ageRating: 'R18' } })?.contentRating).toBe('R18')
    expect(catalogInternals.tmdbMedia({ id: 1, title: 'Test', adult: true }, 'movie')?.isAdult).toBe(true)
  })
})
