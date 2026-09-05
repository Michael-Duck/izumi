import { describe, it, expect } from 'vitest'
import { rankRecommendations, type TasteItem, type TasteSignal } from './recommendation-engine'
const now = Date.UTC(2026, 8, 5)
const item = (key: string, genres = ['Drama'], provider = 'anilist'): TasteItem => ({ key, title: key, genres, provider, quality: .8 })
const rank = (items: TasteItem[], signals: TasteSignal[] = [], excluded: string[] = []) => rankRecommendations(items, signals, { now, excluded })
describe('portable cross-catalog recommendations', () => {
  it('penalizes negative genres instead of silently dropping negative affinity', () => {
    const result = rank([item('horror', ['Horror']), item('drama')], [{ item: item('disliked', ['Horror']), weight: -2 }])
    expect(result[0].key).toBe('drama')
  })
  it('explains a real matching title and never invents a match percentage', () => {
    const result = rank([item('new')], [{ item: item('A favourite'), weight: 2, source: 'library' }])[0]
    expect(result.reason).toContain('A favourite')
    expect(result.evidence.join(' ')).toContain('Drama')
    expect(result.reason).not.toContain('%')
  })
  it('collapses transitive cross-provider duplicates and excludes their aliases', () => {
    const a = { ...item('anilist:1'), aliases: ['mal:1'] }
    const b = { ...item('kitsu:1'), aliases: ['imdb:1'] }
    const bridge = { ...item('bridge'), aliases: ['mal:1', 'imdb:1'] }
    expect(rank([a, b, bridge])).toHaveLength(1)
    expect(rank([a, b, bridge], [], ['imdb:1'])).toHaveLength(0)
  })
  it('does not merge remakes that merely have the same title', () => {
    expect(rank([{ ...item('1'), title: 'The Thing' }, { ...item('2'), title: 'The Thing' }])).toHaveLength(2)
  })
  it('does not count the same seed again for another catalog', () => {
    const seed = { item: { ...item('liked'), aliases: ['shared'] }, weight: 2 }
    const duplicate = { ...seed, item: { ...seed.item, key: 'other-provider' } }
    expect(rank([item('new')], [seed])[0].score).toBe(rank([item('new')], [seed, duplicate])[0].score)
  })
  it('explicit dislike overrides incidental viewing of the same title', () => {
    const liked = item('seed', ['Horror'])
    const result = rank([item('horror', ['Horror']), item('drama')], [
      { item: liked, weight: 1, priority: 1 },
      { item: liked, weight: -1, priority: 3 },
    ])
    expect(result[0].key).toBe('drama')
  })
  it('fades old activity and remains deterministic for the same inputs', () => {
    const fresh = rank([item('new')], [{ item: item('seed'), weight: 2, at: now }])
    const old = rank([item('new')], [{ item: item('seed'), weight: 2, at: now - 365 * 86400000 }])
    expect(fresh[0].score).toBeGreaterThan(old[0].score)
    expect(fresh).toEqual(rank([item('new')], [{ item: item('seed'), weight: 2, at: now }]))
  })
  it('diversifies catalogs with comparable candidates', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(String(i), ['Drama'], i < 20 ? 'tmdb' : 'kitsu'))
    const result = rank(items).slice(0, 6)
    expect(result.some(row => Number(row.key) >= 20)).toBe(true)
    expect(result.every(row => row.exploration && !row.reason.includes('TMDB'))).toBe(true)
  })
  it('normalizes equivalent genre names between catalogs', () => {
    expect(rank([item('new', ['Science Fiction'])], [{ item: item('seed', ['Sci-Fi']), weight: 1 }])[0].exploration).toBe(false)
  })
})
