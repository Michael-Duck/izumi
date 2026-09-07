import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ http: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.http }))
import { fetchKitsuScheduleIndex } from './kitsu-catalog'
import { classifyAiring, emptyMySets } from './my-shows'

it('retains MAL membership and watched progress on Kitsu fallback schedule cards', async () => {
  mocks.http.mockResolvedValue({ ok: true, json: async () => ({
    data: [{ id: '42', attributes: { canonicalTitle: 'Example', slug: 'example' }, relationships: {
      mappings: { data: [{ id: '1', type: 'mappings' }, { id: '2', type: 'mappings' }] },
    } }],
    included: [
      { id: '1', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '7' } },
      { id: '2', type: 'mappings', attributes: { externalSite: 'myanimelist/anime', externalId: '70' } },
    ],
  }) })
  const index = await fetchKitsuScheduleIndex(2026, 'summer', false, true)
  const media = index.get('example')!
  expect(media.idMal).toBe(70)
  const sets = emptyMySets()
  sets.malWatching.add(70)
  sets.malProgress.set(70, 3)
  expect(classifyAiring({ media, episode: 3, airingAt: 100 }, sets)).toBe('watched')
  expect(classifyAiring({ media, episode: 4, airingAt: 100 }, sets)).toBe('watching')
})
