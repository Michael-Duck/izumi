import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), malProgress: vi.fn(), malIds: vi.fn() }))
vi.mock('./client', () => ({ anilist: { query: mocks.query } }))
vi.mock('$lib/trackers', () => ({ getMalAnimeIds: mocks.malIds, getMalListProgress: mocks.malProgress }))
vi.mock('$lib/trackers/kitsu', () => ({ getKitsuAnimeIds: async () => [] }))
vi.mock('$lib/trackers/simkl', () => ({ getSimklAnimeIds: async () => [] }))

import { loadMySets, classifyAiring } from './my-shows'
import type { Media } from './types'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.malIds.mockResolvedValue([])
  mocks.malProgress.mockResolvedValue([])
})

it('loads MAL completion counts without an AniList account or an AniList metadata query', async () => {
  mocks.malProgress.mockImplementation(async (status) => status === 'watching'
    ? [{ idMal: 70, progress: 3, updatedAt: 1 }]
    : [{ idMal: 80, progress: 12, updatedAt: 2 }])
  const sets = await loadMySets(undefined)
  const slot = (idMal: number, episode: number) => ({ media: { id: idMal + 100, idMal } as Media, episode, airingAt: 100 })
  expect(classifyAiring(slot(70, 3), sets)).toBe('watched')
  expect(classifyAiring(slot(70, 4), sets)).toBe('watching')
  expect(classifyAiring(slot(80, 12), sets)).toBe('watched')
  expect(mocks.query).not.toHaveBeenCalled()
})

it('retains AniList progress from both watching and completed lists', async () => {
  mocks.query.mockReturnValue({ toPromise: async () => ({ data: { MediaListCollection: { lists: [{ entries: [
    { status: 'CURRENT', progress: 3, media: { id: 7 } },
    { status: 'COMPLETED', progress: 12, media: { id: 8 } },
  ] }] } } }) })
  const sets = await loadMySets('viewer')
  expect(classifyAiring({ media: { id: 7 } as Media, episode: 3, airingAt: 100 }, sets)).toBe('watched')
  expect(classifyAiring({ media: { id: 8 } as Media, episode: 12, airingAt: 100 }, sets)).toBe('watched')
})
