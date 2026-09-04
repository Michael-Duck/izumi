import { describe, expect, it } from 'vitest'
import type { Airing } from '$lib/anilist/schedule'
import type { Media } from '$lib/anilist/types'
import { mapTraktCalendarRows, mergeCalendarAirings } from './calendar'

const start = new Date(2026, 8, 1).getTime() / 1000
const end = new Date(2026, 8, 8).getTime() / 1000
const ids = { trakt: 10, tmdb: 20 }

describe('Trakt release calendar', () => {
  it('keeps streaming releases distinct from theatrical premieres', () => {
    const [release] = mapTraktCalendarRows([
      { released: '2026-09-03', movie: { title: 'Example movie', ids } },
    ], 'streaming', start, end)
    expect(release).toMatchObject({
      kind: 'movie',
      source: 'trakt',
      eventLabel: 'Streaming release',
      timeKnown: false,
    })
  })

  it('preserves precise finale and grouped-drop meanings', () => {
    const [finale] = mapTraktCalendarRows([{
      first_aired: '2026-09-04T20:00:00.000Z',
      show: { title: 'Example show', ids },
      episode: { season: 3, number: 8, title: 'Goodbye', episode_type: 'series_finale' },
    }], 'finales', start, end)
    expect(finale).toMatchObject({
      season: 3,
      providerEpisode: 8,
      eventLabel: 'Series finale',
      context: 'Goodbye',
      timeKnown: true,
    })
  })

  it('prefers the richer Trakt record when local and Trakt calendars overlap', () => {
    const media = {
      id: -20,
      title: { userPreferred: 'Example' },
      catalog: { provider: 'tmdb', type: 'series', id: '20' },
    } as Media
    const local = { airingAt: start + 2 * 86_400 + 43_200, episode: 2, providerEpisode: 2, season: 1, kind: 'episode', source: 'tmdb', media } as Airing
    const trakt = { ...local, airingAt: start + 2 * 86_400 + 70_000, source: 'trakt', eventLabel: 'Season premiere' } as Airing
    expect(mergeCalendarAirings([trakt], [local])).toEqual([trakt])
  })
})
