import { beforeEach, describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import {
  classifyMine, classifyAiring, isDropped, isMine, hasMySources, emptyMySets, splitAniListIds, withLocalMyShows, type MySets,
} from './my-shows'
import type { Media } from './types'
import type { HistoryEntry } from '$lib/player/history'
import { localLibrary, removeLocalTracking, saveLocalTracking } from '$lib/library/local-lists'

const media = (id: number, idMal?: number) => ({ id, idMal }) as Media
const sets = (over: Partial<MySets>): MySets => ({ ...emptyMySets(), ...over })

describe('episode schedule badges', () => {
  const show = { id: 7, idMal: 70, title: { romaji: 'Example' } } as Media
  const slot = (episode: number) => ({ media: show, episode, airingAt: 100 })
  const library = { lists: [], entries: {} }

  it('marks only the completed MAL episodes Watched while later slots stay Watching', () => {
    const mine = sets({ malWatching: new Set([70]), malProgress: new Map([[70, 3]]) })
    expect(classifyAiring(slot(3), mine)).toBe('watched')
    expect(classifyAiring(slot(4), mine)).toBe('watching')
    expect(classifyAiring({ ...slot(3), delayPlaceholder: true }, mine)).toBe('watching')
    expect(classifyAiring(slot(3), mine, 50_000)).toBe('watching')
  })

  it('reads AniList progress and keeps completed finales visible', () => {
    const mine = sets({ aniProgress: new Map([[7, 12]]) })
    expect(classifyAiring(slot(12), mine)).toBe('watched')
    expect(classifyAiring(slot(13), mine)).toBeNull()
  })

  it('does not mark an opened but unfinished episode watched', () => {
    const history = { 7: { media: show, episode: 4, progress: 3, updatedAt: 1 } }
    const mine = withLocalMyShows(emptyMySets(), history, library)
    expect(classifyAiring(slot(3), mine)).toBe('watched')
    expect(classifyAiring(slot(4), mine)).toBe('watching')
  })

  it('updates from session completion with persisted history disabled', () => {
    const mine = withLocalMyShows(sets({ malWatching: new Set([70]) }), {}, library, { 7: 4 })
    expect(classifyAiring(slot(4), mine)).toBe('watched')
  })

  it('matches a Kitsu play to the canonical schedule and honours marking an episode unwatched', () => {
    const kitsu = { ...show, id: -99, catalog: { provider: 'kitsu', type: 'anime', id: '42' }, externalIds: { anilist: 7 } } as Media
    const history = { [-99]: { media: kitsu, episode: 4, progress: 4, updatedAt: 1 } }
    const remote = sets({ aniWatching: new Set([7]), malProgress: new Map([[70, 4]]) })
    const mine = withLocalMyShows(remote, history, library)
    expect(classifyAiring(slot(4), mine)).toBe('watched')
    const reset = withLocalMyShows(remote, history, library, {}, { [-99]: 3 })
    expect(classifyAiring(slot(4), reset)).toBe('watching')
  })
})

describe('local schedule membership', () => {
  const bleach = { id: 185874, title: { english: 'BLEACH' } } as Media
  beforeEach(() => localLibrary.set({ lists: [], entries: {} }))

  it('does not classify an opened-only episode as Watching', () => {
    const history = { 185874: { media: bleach, episode: 2, progress: 0, updatedAt: 1 } } as Record<number, HistoryEntry>
    const opened = withLocalMyShows(emptyMySets(), history, get(localLibrary))
    expect(classifyMine(bleach, opened)).toBeNull()
    expect(hasMySources(opened)).toBe(false)
    history[185874].progress = 1
    expect(classifyMine(bleach, withLocalMyShows(emptyMySets(), history, get(localLibrary)))).toBe('watching')
  })

  it('honours a fallback-card removal over old history and stale tracker membership', () => {
    const fallback = { ...bleach, id: -900, catalog: { provider: 'kitsu', type: 'anime', id: '50000' }, externalIds: { anilist: bleach.id } } as Media
    const remote = sets({ aniWatching: new Set([bleach.id]) })
    const history = { 185874: { media: bleach, episode: 2, progress: 1, updatedAt: 1 } } as Record<number, HistoryEntry>
    removeLocalTracking(fallback)
    const removed = withLocalMyShows(remote, history, get(localLibrary))
    expect(classifyMine(bleach, removed)).toBeNull()
    expect(classifyMine(fallback, removed)).toBeNull()
    saveLocalTracking(fallback, { status: 'PLANNING' })
    expect(classifyMine(bleach, withLocalMyShows(remote, history, get(localLibrary)))).toBe('planning')
    saveLocalTracking(fallback, { status: 'DROPPED' })
    expect(classifyMine(bleach, withLocalMyShows(remote, history, get(localLibrary)))).toBeNull()
  })

  it('applies a tracker’s Dropped status to a provider-native Kitsu card', () => {
    const fallback = { ...bleach, id: -900, catalog: { provider: 'kitsu', type: 'anime', id: '50000' }, externalIds: { anilist: bleach.id } } as Media
    const history = { 185874: { media: bleach, episode: 2, progress: 1, updatedAt: 1 } } as Record<number, HistoryEntry>
    const dropped = withLocalMyShows(sets({ aniDropped: new Set([bleach.id]) }), history, get(localLibrary))
    expect(classifyMine(fallback, dropped)).toBeNull()
  })
})

describe('classifyMine', () => {
  it('marks an AniList watching entry', () => {
    expect(classifyMine(media(1), sets({ aniWatching: new Set([1]) }))).toBe('watching')
  })

  it('marks a MAL planning entry by idMal', () => {
    expect(classifyMine(media(1, 99), sets({ malPlanning: new Set([99]) }))).toBe('planning')
  })

  it('treats local history as watching when nothing says otherwise', () => {
    expect(classifyMine(media(1), sets({ local: new Set([1]) }))).toBe('watching')
  })

  it('drops a locally-watched show once AniList says DROPPED', () => {
    const s = sets({ local: new Set([1]), aniDropped: new Set([1]) })
    expect(classifyMine(media(1), s)).toBeNull()
    expect(isMine(media(1), s)).toBe(false)
  })

  it('drops a locally-watched show once MAL says dropped', () => {
    const s = sets({ local: new Set([1]), malDropped: new Set([99]) })
    expect(classifyMine(media(1, 99), s)).toBeNull()
  })

  it('keeps a show that one tracker dropped but another still lists as watching', () => {
    const s = sets({ local: new Set([1]), aniDropped: new Set([1]), malWatching: new Set([99]) })
    expect(classifyMine(media(1, 99), s)).toBe('watching')
  })

  it('does not let a dropped idMal veto a different title with no idMal', () => {
    expect(classifyMine(media(1), sets({ local: new Set([1]), malDropped: new Set([99]) }))).toBe('watching')
  })
})

describe('isDropped', () => {
  it('is false for an untracked title', () => {
    expect(isDropped(media(1, 99), emptyMySets())).toBe(false)
  })
})

describe('hasMySources', () => {
  it('does not count a dropped list as a source to personalize from', () => {
    expect(hasMySources(sets({ aniDropped: new Set([1]), malDropped: new Set([99]) }))).toBe(false)
  })
})

describe('splitAniListIds', () => {
  it('splits one status_in collection and deduplicates custom-list copies', () => {
    const result = splitAniListIds({ MediaListCollection: { lists: [
      { entries: [
        { status: 'CURRENT', media: { id: 1 } },
        { status: 'PLANNING', media: { id: 2 } },
      ] },
      { entries: [
        { status: 'CURRENT', media: { id: 1 } },
        { status: 'DROPPED', media: { id: 3 } },
      ] },
    ] } })
    expect([...result.CURRENT]).toEqual([1])
    expect([...result.PLANNING]).toEqual([2])
    expect([...result.DROPPED]).toEqual([3])
  })
})
