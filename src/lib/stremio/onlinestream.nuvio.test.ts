import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, readable, writable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import type { Stream } from './parse'
import type { StreamExtension } from '$lib/extensions/manager'

const mocks = vi.hoisted(() => ({ extensions: vi.fn(), ids: vi.fn() }))
vi.mock('$lib/extensions/manager', () => ({ runningStreamExtensions: mocks.extensions }))
vi.mock('$lib/anizip', () => ({ getExtensionIds: mocks.ids }))
const audio = writable('both')
vi.mock('$lib/settings/ui', () => ({
  titleLanguage: readable('english'),
  preferredAudioLang: readable('jpn'), preferredSubLang: readable('eng'), providerLanguages: readable([]),
  providerAudio: { subscribe: (fn: (value: string) => void) => audio.subscribe(fn) },
}))
import { providerProblems, resolveOnlineStreams } from './onlinestream'

const anime: Media = { id: 123, format: 'TV', title: { romaji: 'Example' } }
const movie: Media = { id: -1, catalog: { provider: 'tmdb', type: 'movie', id: '42' }, title: { english: 'Example Movie' } }
const tv: Media = { id: -2, catalog: { provider: 'tmdb', type: 'series', id: '99' },
  title: { english: 'Example Series' }, videos: [{ number: 15, season: 2, episode: 3 }] }
const stream = { url: 'https://cdn.test/watch.m3u8?token=abc', title: 'Example release', name: 'Server 1', quality: '1080p',
  headers: { Referer: 'https://provider.test', 'User-Agent': 'Provider' },
  subtitles: [{ file: 'https://cdn.test/en.vtt', language: 'en', headers: { Referer: 'https://subtitle.test' } }] }

function provider(id = 'nuvio:repo:example', call = vi.fn().mockResolvedValue([stream])): StreamExtension {
  return { id, name: 'Nuvio example', runtime: 'nuvio', supportedTypes: ['movie', 'tv'], call, icon: 'https://provider.test/logo.png' }
}
beforeEach(() => {
  mocks.extensions.mockReset(); mocks.ids.mockReset(); audio.set('both')
  mocks.ids.mockResolvedValue({ tmdbId: '789', season: 2, episodeNumber: 4 })
})

describe('Nuvio playback integration', () => {
  it('uses mapped TMDB and season numbering and preserves playback metadata', async () => {
    const ext = provider(); mocks.extensions.mockResolvedValue([ext])
    const batches: Stream[][] = []
    const rows = await resolveOnlineStreams(anime, 16, undefined, (batch) => batches.push(batch))
    expect(ext.call).toHaveBeenCalledExactlyOnceWith('getStreams', '789', 'tv', 2, 4)
    expect(mocks.ids).toHaveBeenCalledWith(123, 16)
    expect(rows).toEqual([expect.objectContaining({
      url: stream.url, __stream: true, __manifest: 'hls', __headers: stream.headers,
      __quality: '1080p', __server: 'Server 1', __audio: undefined,
      __origin: { kind: 'online-extension', id: ext.id, name: ext.name }, __logo: ext.icon,
      __subtitles: [expect.objectContaining({ url: 'https://cdn.test/en.vtt', lang: 'eng', isDefault: true,
        headers: { Referer: 'https://subtitle.test' } })],
    })])
    expect(batches).toEqual([rows])
  })

  it('resolves a movie without requiring an episode or querying legacy providers', async () => {
    const ext = provider(); const legacy = { id: 'legacy', name: 'Legacy', call: vi.fn() }
    mocks.extensions.mockResolvedValue([ext, legacy])
    expect(await resolveOnlineStreams(movie, undefined)).toHaveLength(1)
    expect(ext.call).toHaveBeenCalledExactlyOnceWith('getStreams', '42', 'movie')
    expect(mocks.ids).not.toHaveBeenCalled(); expect(legacy.call).not.toHaveBeenCalled()
  })

  it('uses catalogue numbering, including specials season zero', async () => {
    const ext = provider(); mocks.extensions.mockResolvedValue([ext])
    await resolveOnlineStreams(tv, 15)
    expect(ext.call).toHaveBeenCalledWith('getStreams', '99', 'tv', 2, 3)
    await resolveOnlineStreams({ ...tv, videos: [{ number: 15, season: 0, episode: 2 }] }, 15)
    expect(ext.call).toHaveBeenLastCalledWith('getStreams', '99', 'tv', 0, 2)
  })

  it('shares mapping work, skips unsupported types and emits faster providers immediately', async () => {
    let finish!: (value: unknown) => void
    const slow = provider('slow', vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve })))
    const fast = provider('fast')
    const unsupported = { ...provider('movies'), supportedTypes: ['movie'] as ['movie'] }
    mocks.extensions.mockResolvedValue([slow, fast, unsupported])
    const batches: Stream[][] = []
    const done = resolveOnlineStreams(anime, 16, undefined, (batch) => batches.push(batch))
    await vi.waitFor(() => expect(batches).toHaveLength(1))
    expect(batches[0][0].__origin?.id).toBe('fast')
    finish([]); await done
    expect(mocks.ids).toHaveBeenCalledTimes(1); expect(unsupported.call).not.toHaveBeenCalled()
  })

  it('reports missing mappings and provider errors while keeping other sources usable', async () => {
    mocks.ids.mockResolvedValue({})
    const ext = provider(); mocks.extensions.mockResolvedValue([ext])
    expect(await resolveOnlineStreams(anime, 1)).toEqual([])
    expect(ext.call).not.toHaveBeenCalled(); expect(get(providerProblems)[0].message).toMatch(/TMDB mapping/)
    mocks.extensions.mockResolvedValue([provider('broken', vi.fn().mockRejectedValue(new Error('Unavailable module'))), ext])
    expect(await resolveOnlineStreams(movie, undefined)).toHaveLength(1)
    expect(get(providerProblems)[0].message).toBe('Unavailable module')
  })

  it('does not guess a season when the title only has a TMDB id', async () => {
    const ext = provider(); mocks.extensions.mockResolvedValue([ext])
    expect(await resolveOnlineStreams({ ...tv, videos: undefined }, 15)).toEqual([])
    expect(ext.call).not.toHaveBeenCalled(); expect(get(providerProblems)[0].message).toMatch(/season\/episode mapping/)
  })

  it('ignores malformed rows, preserves header variants, and applies explicit audio filtering', async () => {
    const ext = provider('variants', vi.fn().mockResolvedValue([
      null, {}, { url: 'javascript:alert(1)' }, stream, stream,
      { ...stream, headers: {}, audio: 'dub' }, { ...stream, url: 'https://cdn.test/dash.mpd', audio: 'sub' },
    ]))
    mocks.extensions.mockResolvedValue([ext])
    expect(await resolveOnlineStreams(movie, undefined)).toHaveLength(3)
    audio.set('sub')
    const batches: Stream[][] = []
    const rows = await resolveOnlineStreams(movie, undefined, undefined, (batch) => batches.push(batch))
    expect(rows).toHaveLength(2); expect(rows[1].__manifest).toBe('dash'); expect(batches).toEqual([rows])
  })

  it('suppresses results and callbacks after cancellation', async () => {
    const controller = new AbortController()
    const ext = provider('cancel', vi.fn().mockImplementation(() => { controller.abort(); return [stream] }))
    mocks.extensions.mockResolvedValue([ext])
    const batch = vi.fn()
    expect(await resolveOnlineStreams(movie, undefined, undefined, batch, controller.signal)).toEqual([])
    expect(batch).not.toHaveBeenCalled()
  })
})
