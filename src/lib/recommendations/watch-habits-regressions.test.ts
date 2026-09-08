import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { mediaKey } from '$lib/catalog/identity'
import { localLibrary, saveLocalTracking, setMediaInLocalList, type LocalLibraryState } from '$lib/library/local-lists'
import { durableHistory, incognitoHistory, mediaSnapshot, recordPlay, recordProgress } from '$lib/player/history'
import { saveLocalHistory } from '$lib/settings/ui'
import { enterIncognito, exitIncognito } from '$lib/stores/incognito'
import { discoveryQueueFeedback, historyTasteSeeds, libraryTasteSeeds, feedbackTasteSeeds,
  rankDiscoveryQueue, discoveryTasteItem, type DiscoveryQueueFeedbackState } from '$lib/recommendations/discovery-queue'
import { accountSeed, rankForYou, mergeForYouSeeds, historySeeds } from '$lib/recommendations/for-you'
import { rankRecommendations } from '$lib/shared/recommendation-engine'
import { companionDiscovery } from '$lib/companion/discovery'

const network = vi.hoisted(() => ({ candidates: vi.fn() }))
vi.mock('$lib/recommendations/candidates', () => ({ loadDiscoveryCandidates: network.candidates }))

const DAY = 86_400_000
let now = Date.UTC(2026, 8, 8, 12)
const media = (id: number, genre = 'Drama', extra: Partial<Media> = {}): Media => ({
  id, title: { userPreferred: `Fixture ${id}` }, genres: [genre], format: 'TV',
  episodes: 12, averageScore: 75, ...extra,
})
const history = (item: Media, progress: number, episode = Math.max(1, progress)) => ({
  [item.id]: { media: item, progress, episode, updatedAt: now },
})
const library = (item: Media, score: number, status: 'COMPLETED' | 'DROPPED' = 'COMPLETED', saved = true): LocalLibraryState => ({
  lists: [], entries: { [mediaKey(item)]: { media: item, listIds: saved ? ['watchlist'] : [],
    addedAt: now, updatedAt: now, tracking: { status, score } } },
})
const empty: DiscoveryQueueFeedbackState = { records: {} }
const choices = (item: Media, action: 'save' | 'dismiss' | 'skip', at = now): DiscoveryQueueFeedbackState => ({
  records: { [mediaKey(item)]: { action, at, media: item } },
})
const queue = (items: Media[], seeds: ReturnType<typeof historyTasteSeeds>, feedback = empty) =>
  rankDiscoveryQueue(items, seeds, feedback, { now }).map(row => mediaKey(row.media))

beforeEach(() => {
  now += 16 * 60_000 // Expire the real Companion metadata cache between scenarios.
  vi.useFakeTimers(); vi.setSystemTime(now)
  exitIncognito(); saveLocalHistory.set(true)
  durableHistory.set({}); localLibrary.set({ lists: [], entries: {} })
  discoveryQueueFeedback.set({ records: {} })
  network.candidates.mockReset()
  network.candidates.mockResolvedValue({ media: [], failedProviders: [], hasNextPage: false })
})
afterEach(() => { exitIncognito(); vi.useRealTimers() })

describe('Established behavior: control cases', () => {
  it('C1 matches positive genre evidence and is deterministic', () => {
    const items = [media(10, 'Horror'), media(11)]
    const seeds = historyTasteSeeds(history(media(1), 12), now)
    expect(queue(items, seeds)[0]).toBe(mediaKey(items[1]))
    expect(queue(items, seeds)).toEqual(queue(items, seeds))
  })
  it('C2 explicit dismiss reduces affinity and excludes the exact title', () => {
    const disliked = media(1, 'Horror'), other = media(2), related = media(3, 'Horror')
    const feedback = choices(disliked, 'dismiss')
    expect(queue([disliked, related, other], feedbackTasteSeeds(feedback), feedback))
      .toEqual([mediaKey(other), mediaKey(related)])
  })
  it('C3 skip is neutral taste and expires after seven days', () => {
    const item = media(1), feedback = choices(item, 'skip')
    expect(feedbackTasteSeeds(feedback)).toEqual([])
    expect(queue([item], [], feedback)).toEqual([])
    expect(rankDiscoveryQueue([item], [], feedback, { now: now + 7 * DAY })).toHaveLength(1)
  })
  it('C4 verified aliases deduplicate and propagate exclusions', () => {
    const original = media(1, 'Drama', { externalIds: { imdb: 'tt1234567' } })
    const alias = media(-2, 'Drama', { catalog: { provider: 'tmdb', type: 'series', id: '2' }, externalIds: { imdb: 'tt1234567' } })
    expect(queue([original, alias], [])).toHaveLength(1)
    expect(rankDiscoveryQueue([alias], historyTasteSeeds(history(original, 12), now), empty,
      { now, excludedKeys: [mediaKey(original)] })).toHaveLength(0)
  })
  it('C5 incognito recordPlay and recordProgress do not enter durable taste', () => {
    enterIncognito(); recordPlay(media(1), 4); recordProgress(media(1), 4)
    expect(get(incognitoHistory)[1].progress).toBe(4)
    expect(historyTasteSeeds(get(durableHistory), now)).toEqual([])
    exitIncognito(); expect(get(incognitoHistory)).toEqual({})
  })
  it('C6 completed history contributes more than one confirmed episode', () => {
    expect(historyTasteSeeds(history(media(1), 12), now)[0].weight)
      .toBeGreaterThan(historyTasteSeeds(history(media(1), 1), now)[0].weight)
  })
  it('C7 cached Companion metadata still reads fresh explicit taste', async () => {
    const drama = media(10), horror = media(11, 'Horror')
    network.candidates.mockResolvedValue({ media: [drama, horror] })
    durableHistory.set(history(media(1, 'Horror'), 12))
    expect((await companionDiscovery([]))?.candidates[0].ref.id).toBe('11')
    discoveryQueueFeedback.set(choices(media(1, 'Horror'), 'dismiss'))
    expect((await companionDiscovery([]))?.candidates[0].ref.id).toBe('10')
    expect(network.candidates).toHaveBeenCalledTimes(1)
  })
})

describe('Watch-habit regression criteria', () => {
  it('E1 an uncompleted open must carry less evidence than a completed series', () => {
    const opened = historyTasteSeeds(history(media(1, 'Horror', { episodes: undefined }), 0, 3), now)[0]
    const completed = historyTasteSeeds(history(media(2), 12), now)[0]
    expect(opened?.weight ?? 0).toBeLessThan(completed.weight)
    expect(opened).toBeUndefined()
  })
  it('E2 a 2/10 completed rating should not promote related titles over an unrelated equal-quality title', () => {
    const disliked = media(1, 'Horror'), related = media(2, 'Horror'), unrelated = media(3)
    const seeds = libraryTasteSeeds(library(disliked, 20))
    expect(queue([related, unrelated], seeds)[0]).toBe(mediaKey(unrelated))
  })
  it('E3 an earlier save should not reverse a later explicit negative rating', () => {
    const disliked = media(1, 'Horror'), related = media(2, 'Horror'), unrelated = media(3)
    const rated = libraryTasteSeeds(library(disliked, 10, 'DROPPED', false))
    expect(queue([related, unrelated], rated)[0]).toBe(mediaKey(unrelated))
    const saved = feedbackTasteSeeds(choices(disliked, 'save', now - DAY))
    expect(queue([related, unrelated], [...rated, ...saved])[0]).toBe(mediaKey(unrelated))
  })
  it('E4 a known director affinity should survive the actual history snapshot pipeline', () => {
    const seed = media(1, 'Drama', { creators: ['Fixture Director'] })
    const candidate = media(2, 'Thriller', { creators: ['Fixture Director'] })
    const before = rankDiscoveryQueue([candidate], historyTasteSeeds(history(seed, 12), now), empty, { now })[0]
    expect(before.exploration).toBe(false)
    const after = rankDiscoveryQueue([candidate], historyTasteSeeds(history(mediaSnapshot(seed), 12), now), empty, { now })[0]
    expect(after.exploration).toBe(false)
  })
  it('E5 100 saved library titles should not erase all positive viewing evidence on TV', async () => {
    const libraryItems = Array.from({ length: 100 }, (_, i) => media(1000 + i, 'Comedy'))
    localLibrary.set({ lists: [], entries: Object.fromEntries(libraryItems.map(item => [mediaKey(item), {
      media: item, listIds: ['watchlist'], addedAt: now, updatedAt: now,
    }])) })
    durableHistory.set(history(media(1, 'Horror'), 12))
    const candidate = media(2, 'Horror')
    network.candidates.mockResolvedValue({ media: [candidate] })
    const fullClient = rankDiscoveryQueue([candidate], [...libraryTasteSeeds(get(localLibrary)),
      ...historyTasteSeeds(get(durableHistory), now)], empty, { now })[0]
    expect(fullClient.exploration).toBe(false)
    const tv = await companionDiscovery([])
    expect(tv?.candidates[0].recommendation?.exploration).toBe(false)
  })
  it('E6 completed low-rated seeds should not positively support the older anime row', () => {
    const disliked = media(1, 'Horror'), candidate = media(2, 'Horror')
    const seed = accountSeed(disliked, 20, 'COMPLETED', 12)
    const results = rankForYou([seed], [{ seedId: 1, rating: 10, media: candidate }])
    expect(results.filter(item => item.score > 0)).toEqual([])
  })
  it('E7 changing catalog order should not discard richer features of the same verified title', () => {
    const a = discoveryTasteItem(media(1, 'Drama', { externalIds: { imdb: 'tt1234567' } }))
    const b = { ...a, key: 'other:1', people: ['creator:Fixture Director'] }
    const seed = { item: { ...a, key: 'seed', aliases: [], people: ['creator:Fixture Director'], genres: ['Thriller'] }, weight: 2 }
    const firstSparse = rankRecommendations([a, b], [seed], { now })[0]
    const firstRich = rankRecommendations([b, a], [seed], { now })[0]
    expect(firstRich.exploration).toBe(false)
    expect(firstSparse.exploration).toBe(false)
  })
  it('E8 TV must exclude a verified watched alias even when its history seed exceeds the budget', async () => {
    const watched = media(1, 'Horror', { externalIds: { imdb: 'tt1234567' } })
    const alias = media(-2, 'Horror', { catalog: { provider: 'tmdb', type: 'series', id: '2' }, externalIds: { imdb: 'tt1234567' } })
    const libraryItems = Array.from({ length: 100 }, (_, i) => media(1000 + i, 'Comedy'))
    localLibrary.set({ lists: [], entries: Object.fromEntries(libraryItems.map(item => [mediaKey(item), {
      media: item, listIds: ['watchlist'], addedAt: now, updatedAt: now,
    }])) })
    durableHistory.set(history(watched, 12))
    network.candidates.mockResolvedValue({ media: [alias] })
    expect((await companionDiscovery([]))?.candidates).toHaveLength(0)
  })
})

describe('Preference precedence and evidence boundaries', () => {
  it('does not treat unknown episode totals as completed viewing', () => {
    const unknown = historyTasteSeeds(history(media(1, 'Drama', { episodes: undefined }), 4), now)[0]
    const complete = historyTasteSeeds(history(media(2), 12), now)[0]
    expect(unknown.weight).toBeLessThan(complete.weight)
    expect(historyTasteSeeds(history(media(3), 0), now)).toEqual([])
    expect(historySeeds(history(media(3), 0), now)).toEqual([])
  })
  it('reopening a previously watched title does not refresh its taste clock', () => {
    const item = media(1)
    vi.setSystemTime(now - 30 * DAY)
    recordProgress(item, 12)
    vi.setSystemTime(now)
    recordPlay(item, 1)
    const saved = get(durableHistory)[1]
    expect(saved.updatedAt).toBe(now)
    expect(historyTasteSeeds(get(durableHistory), now)[0].at).toBe(now - 30 * DAY)
  })
  it('automatic progress keeps the original rating clock', () => {
    const item = media(1)
    vi.setSystemTime(now - DAY)
    saveLocalTracking(item, { score: 20 })
    vi.setSystemTime(now)
    saveLocalTracking(item, { status: 'COMPLETED', progress: 12 })
    expect(libraryTasteSeeds(get(localLibrary))[0]).toMatchObject({ at: now - DAY, priority: 4 })
  })
  it('preserves a legacy rating clock before the first automatic list update', () => {
    const item = media(1)
    const saved = library(item, 20)
    saved.entries[mediaKey(item)].updatedAt = now - DAY
    localLibrary.set(saved)
    setMediaInLocalList(item, 'watchlist', true)
    saveLocalTracking(item, { progress: 12, status: 'COMPLETED' })
    expect(libraryTasteSeeds(get(localLibrary))[0].at).toBe(now - DAY)
  })
  it('uses the latest direct opinion across aliases even when its magnitude is smaller', () => {
    const item = media(1, 'Horror', { externalIds: { imdb: 'tt1234567' } })
    const rated = libraryTasteSeeds(library(item, 65))
    const dismissed = feedbackTasteSeeds(choices({ ...item, id: 2 }, 'dismiss', now - DAY))
    const result = rankDiscoveryQueue([media(10, 'Horror')], [...dismissed, ...rated], empty, { now })[0]
    expect(result.exploration).toBe(false)
    const laterDismiss = feedbackTasteSeeds(choices({ ...item, id: 2 }, 'dismiss', now + 1))
    expect(rankDiscoveryQueue([media(10, 'Horror')], [...rated, ...laterDismiss], empty, { now })[0].exploration).toBe(true)
  })
  it('a neutral rating suppresses positive history and saved intent', () => {
    const item = media(1, 'Horror')
    const seeds = [...historyTasteSeeds(history(item, 12), now), ...feedbackTasteSeeds(choices(item, 'save')),
      ...libraryTasteSeeds(library(item, 60))]
    expect(rankDiscoveryQueue([media(2, 'Horror')], seeds, empty, { now })[0].exploration).toBe(true)
  })
  it('a low account rating overrides positive history in the older row merge', () => {
    const item = media(1, 'Horror'), candidate = media(2, 'Horror')
    const seeds = mergeForYouSeeds(historySeeds(history(item, 12), now), [accountSeed(item, 20, 'COMPLETED', 12)])
    expect(rankForYou(seeds, [{ seedId: 1, rating: 100, media: candidate }])).toEqual([])
  })
  it('keeps bounded, non-spoiler metadata without images or cast payloads', () => {
    const item = media(1, 'Drama', { originalLanguage: 'ja', countryOfOrigin: 'JP', seasonYear: 2007,
      tags: [{ name: 'Spoiler', isMediaSpoiler: true }, { name: 'Weak tag', rank: 10 }, { name: 'Space', rank: 90 }],
      staff: { edges: [{ role: 'Director', node: { id: 7, name: { full: 'Director' }, image: { large: 'unused' } } }] },
      studios: { nodes: Array.from({ length: 30 }, (_, id) => ({ id, name: `Studio ${id}` })) },
    })
    const snapshot = mediaSnapshot(item), taste = discoveryTasteItem(snapshot)
    expect(taste).toMatchObject({ language: 'jpn', country: 'JP', year: 2007, tags: ['Space'], people: ['anilist:7'] })
    expect(snapshot.studios?.nodes).toHaveLength(8)
    expect(snapshot.staff?.edges[0].node.image).toBeUndefined()
  })
  it('preserves exclusion identities even when hundreds of history signals exceed the TV budget', () => {
    const watched = media(1, 'Horror', { externalIds: { imdb: 'tt1234567' } })
    const alias = media(-2, 'Horror', { catalog: { provider: 'tmdb', type: 'series', id: '2' }, externalIds: { imdb: 'tt1234567' } })
    const historyItems = Array.from({ length: 200 }, (_, index) => ({ media: media(1000 + index), weight: 1, priority: 1, at: now }))
    const seeds = [...historyItems, { media: watched, weight: 1, priority: 1, at: now - DAY }]
    expect(rankDiscoveryQueue([alias], seeds, empty, { now, signalLimit: 100, excludedKeys: [mediaKey(watched)] })).toEqual([])
  })
})
