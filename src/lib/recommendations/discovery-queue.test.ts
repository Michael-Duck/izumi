import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import type { LocalLibraryState } from '$lib/library/local-lists'
import {
  discoveryDecisionHides,
  feedbackTasteSeeds,
  libraryTasteSeeds,
  rankDiscoveryQueue,
  type DiscoveryQueueFeedbackState,
} from './discovery-queue'

const movie = (id: number, genres: string[], language = 'en', averageScore = 75): Media => ({
  id: -id,
  catalog: { provider: 'tmdb', type: 'movie', id: String(id) },
  type: 'MOVIE',
  format: 'MOVIE',
  title: { userPreferred: `Movie ${id}` },
  genres,
  originalLanguage: language,
  averageScore,
  popularity: 100,
})

describe('Discovery Queue affinity', () => {
  it('treats skip as a seven-day snooze and dismiss/save as durable decisions', () => {
    const now = 1_000
    const media = movie(1, ['Drama'])
    expect(discoveryDecisionHides({ action: 'skip', at: now, until: now + 10, media }, now)).toBe(true)
    expect(discoveryDecisionHides({ action: 'skip', at: now, until: now + 10, media }, now + 11)).toBe(false)
    expect(discoveryDecisionHides({ action: 'dismiss', at: now, media }, now + 99_999)).toBe(true)
    expect(discoveryDecisionHides({ action: 'save', at: now, media }, now + 99_999)).toBe(true)
  })

  it('turns library completion and dropped status into opposite taste signals', () => {
    const liked = movie(1, ['Drama'])
    const dropped = movie(2, ['Horror'])
    const state: LocalLibraryState = {
      lists: [],
      entries: {
        liked: { media: liked, listIds: ['watchlist'], addedAt: 1, updatedAt: 1, tracking: { status: 'COMPLETED', score: 90 } },
        dropped: { media: dropped, listIds: [], addedAt: 1, updatedAt: 1, tracking: { status: 'DROPPED' } },
      },
    }
    const seeds = libraryTasteSeeds(state)
    expect(seeds.find((seed) => seed.media.id === liked.id)?.weight).toBeGreaterThan(1)
    expect(seeds.find((seed) => seed.media.id === dropped.id)?.weight).toBeLessThan(0)
  })

  it('ranks matching taste first, filters decisions/library, and explains the result', () => {
    const drama = movie(1, ['Drama'], 'ko', 82)
    const comedy = movie(2, ['Comedy'], 'en', 82)
    const hidden = movie(3, ['Drama'], 'ko', 95)
    const feedback: DiscoveryQueueFeedbackState = {
      records: {
        'tmdb:movie:3': { action: 'dismiss', at: 1, media: hidden },
      },
    }
    const ranked = rankDiscoveryQueue(
      [comedy, hidden, drama, comedy],
      [{ media: movie(99, ['Drama'], 'ko'), weight: 1.4 }, ...feedbackTasteSeeds(feedback)],
      feedback,
      { now: 2, excludedKeys: ['tmdb:movie:2'] },
    )
    expect(ranked.map((item) => item.media.id)).toEqual([drama.id])
    expect(ranked[0].reason).toContain('Drama')
  })
})
