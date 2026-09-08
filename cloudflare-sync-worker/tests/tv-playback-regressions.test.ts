import { beforeEach, expect, it, vi } from 'vitest'
const adapters = vi.hoisted(() => ({ resolve: vi.fn(), sidecars: vi.fn() }))
vi.mock('../src/generated/resolver-core/debrid/index.ts', async importOriginal => ({
  ...await importOriginal<object>(), resolveHash: adapters.resolve, resolveSidecars: adapters.sidecars, cacheCheckMode: () => 'none',
}))
import { providers } from '../src/generated/resolver-core/debrid/index.ts'
import { publicResolverProfile, resolveDirectSources } from '../src/resolver.js'
import { resolveSubtitleDownload, searchSubtitleServices } from '../src/subtitle-services.js'
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const movie = { ref: { provider: 'tmdb', type: 'movie', id: '123' }, streamType: 'movie', streamIds: ['tt0123456'], title: 'Example Film' }
beforeEach(() => { adapters.resolve.mockReset(); adapters.sidecars.mockReset().mockResolvedValue([]) })
it('returns multiple converted choices and does not let a subtitle failure discard video', async () => {
  adapters.resolve.mockImplementation(async (_provider, _key, magnet: string) => `https://media.example/${magnet.slice(-40)}.mkv`)
  adapters.sidecars.mockRejectedValue(new Error('Subtitle service unavailable'))
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'], debrid: { provider: providers.keys().next().value, credential: 'private-key' } }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: ['a', 'b', 'c', 'd'].map(char => ({ infoHash: char.repeat(40), title: `Example Film 1080p ${char}` })) }))
  expect(result.candidates).toHaveLength(3)
  expect(new Set(result.candidates.map(item => item.url)).size).toBe(3)
  expect(adapters.resolve).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(result)).not.toContain('private-key')
})
it('filters preview and unsupported video before ranking while keeping valid alternatives', async () => {
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams: [
      { title: 'Example Film Prologue 2160p', url: 'https://media.example/preview.mkv' },
      { title: 'Example Film DV 2160p', url: 'https://media.example/unsupported.mkv' },
      { title: 'Example Film 1080p', url: 'https://media.example/full.mkv' },
    ] }))
  expect(result.candidates.map(item => item.url)).toEqual(['https://media.example/full.mkv'])
})
it('queries subtitle-only add-ons and preserves descriptive track names and language preferences', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === 'https://captions.example/manifest.json') return json({ resources: [{ name: 'subtitles', types: ['movie'], idPrefixes: ['tt'] }] })
    if (url.includes('/manifest.json')) return json({ resources: ['stream'] })
    if (url.includes('/subtitles/movie/tt0123456.json')) return json({ subtitles: [{ url: 'https://subs.example/en.srt', lang: 'eng', title: 'English SDH' }] })
    return json({ streams: [{ url: 'https://media.example/full.mp4' }] })
  })
  const result = await resolveDirectSources({ enabled: true, subtitleLang: 'eng', addons: ['https://source.example', 'https://captions.example'] }, movie, fetcher)
  expect(result.trackPreferences.subtitle).toEqual({ language: 'eng' })
  expect(result.candidates[0].subtitles).toContainEqual({ url: 'https://subs.example/en.srt', title: 'English SDH', lang: 'eng' })
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('https://captions.example/stream/'))).toBe(false)
})
it('searches exact episode identity without spending download quota or exposing keys', async () => {
  const services = [{ kind: 'rest-v1', base: 'https://captions.example', apiKey: 'private-search-key' }]
  const fetcher = vi.fn(async () => json({ data: [{ attributes: { language: 'en', files: [{ file_id: 42, file_name: 'English dialogue' }] } }] }))
  const tracks = await searchSubtitleServices({ subtitleServices: services, subtitleLang: 'eng' }, { streamType: 'series' }, { ids: ['tt0123456:2:7'] }, fetcher)
  expect(String(fetcher.mock.calls[0][0])).toContain('episode_number=7&languages=en&parent_imdb_id=123456&season_number=2')
  expect(tracks[0]).toEqual({ title: 'English dialogue', lang: 'en', download: { serviceIndex: 0, fileId: 42 } })
  expect(JSON.stringify(tracks)).not.toContain('private-search-key')
  const download = vi.fn(async () => json({ link: 'https://subs.example/selected.srt' }))
  expect(await resolveSubtitleDownload(tracks[0].download, services, download)).toBe('https://subs.example/selected.srt')
  expect(JSON.parse(download.mock.calls[0][1].body)).toEqual({ file_id: 42, sub_format: 'srt' })
  const visible = publicResolverProfile({ addons: [], subtitleServices: services })
  expect(JSON.stringify(visible)).not.toContain('private-search-key')
})

it('uses only an unexpired private subtitle session and redacts it from public settings', async () => {
  const service = { kind: 'rest-v1', base: 'https://captions.example', apiKey: 'private-key', token: 'private-session', expires: Date.now() + 60_000 }
  const fetcher = vi.fn(async () => json({ link: 'https://subs.example/selected.srt' }))
  await resolveSubtitleDownload({ serviceIndex: 0, fileId: 42 }, [service], fetcher)
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer private-session')
  await resolveSubtitleDownload({ serviceIndex: 0, fileId: 42 }, [{ ...service, expires: Date.now() - 1 }], fetcher)
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined()
  expect(JSON.stringify(publicResolverProfile({ addons: [], subtitleServices: [service] }))).not.toContain('private-session')
})

it('ignores malformed subtitle capabilities without losing playable streams', async () => {
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] }, movie,
    async (url: string) => json(url.endsWith('/manifest.json') ? { resources: [null, { name: 'subtitles', idPrefixes: [null] }, 'stream'] } : { streams: [{ url: 'https://media.example/full.mp4' }] }))
  expect(result.candidates[0].url).toBe('https://media.example/full.mp4')
})
