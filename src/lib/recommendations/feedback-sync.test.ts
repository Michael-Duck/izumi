import { describe, expect, it } from 'vitest'
import { mergeDiscoveryFeedback } from './discovery-queue'
const media = { id: 1, title: { english: 'A film' }, genres: ['Drama'] }
const choice = { records: { 'anilist:anime:1': { media, action: 'skip' as const, at: 100 } } }
describe('discovery sync conflict handling', () => {
  it('does not resurrect an undone choice from an older device', () => {
    const undone = { records: {}, removed: { 'anilist:anime:1': 200 } }
    expect(mergeDiscoveryFeedback(undone, choice, 1000).records).toEqual({})
    expect(mergeDiscoveryFeedback(choice, undone, 1000).records).toEqual({})
  })
  it('accepts a newer deliberate choice after an undo', () => {
    expect(mergeDiscoveryFeedback({ records: {}, removed: { 'anilist:anime:1': 50 } }, choice, 1000).records).toHaveProperty('anilist:anime:1')
  })
  it('ignores malformed and future-dated input', () => {
    expect(mergeDiscoveryFeedback({ records: {} }, { records: { bad: { at: Infinity }, poison: { media, action: 'run', at: 10 } } }, 1000).records).toEqual({})
  })
})
