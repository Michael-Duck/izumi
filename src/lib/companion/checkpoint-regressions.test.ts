import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { get } from 'svelte/store'
import { durableHistory } from '$lib/player/history'
import { durablePositions, getPosition } from '$lib/player/progress'
import { loadCatalogProvider } from '$lib/catalog/registry'
import { localLibrary } from '$lib/library/local-lists'
import { saveLocalHistory } from '$lib/settings/ui'
import { profileSwitcherOpen } from '$lib/profiles/store'
import { setCompanionRestorePending } from '$lib/companion/restore-state'
import { syncCompanionProgress, type PairedCompanion } from '$lib/companion/client'
import { readCloudflareCompanionProgress } from '$lib/sync/cloudflare'

vi.mock('$lib/sync/cloudflare', async original => ({
  ...await original<typeof import('$lib/sync/cloudflare')>(),
  readCloudflareDiscoveryChoices: vi.fn().mockResolvedValue([]),
  readCloudflareCompanionProgress: vi.fn(),
}))
const catalog = vi.hoisted(() => ({ detail: vi.fn() }))
vi.mock('$lib/catalog/registry', () => ({ loadCatalogProvider: vi.fn() }))

const now = Date.UTC(2026, 8, 8, 12)
const device: PairedCompanion = {
  deviceId: 'ab'.repeat(12), name: 'Audit fixture TV', address: '', credential: 'ab'.repeat(32), pairedAt: 1,
  cloudflare: { protocol: 1, endpoint: 'https://audit.example', pairingId: 'audit_pairing_123456789',
    tvToken: 'T'.repeat(43), playbackMode: 'cloud-only', wakeWhenClosed: false },
}
const record = (recordKey: string, season = 1, positionSeconds = 300) => ({
  recordKey, profileId: 'default', sessionId: 'fixture-' + recordKey,
  media: { ref: { provider: 'tmdb' as const, type: 'series' as const, id: '77' },
    mediaId: -77, title: 'Audit series', season, episode: 1 },
  positionSeconds, durationSeconds: 1200, completed: false, state: 'paused' as const,
  updatedAt: now - 30 * 86400000,
})
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now)
  vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network in audit') }))
  saveLocalHistory.set(true); profileSwitcherOpen.set(false); setCompanionRestorePending(false)
  durableHistory.set({}); durablePositions.set({})
  localLibrary.set({ lists: [], entries: {} })
  vi.mocked(loadCatalogProvider).mockResolvedValue({ detail: catalog.detail } as never)
  catalog.detail.mockResolvedValue({ id: -77, title: { userPreferred: 'Audit series' },
    catalog: { provider: 'tmdb', type: 'series', id: '77' }, episodes: 4,
    creators: ['Known Director'],
    videos: [{ number: 1, season: 1, episode: 1 }, { number: 2, season: 1, episode: 2 },
      { number: 3, season: 2, episode: 1 }, { number: 4, season: 0, episode: 1 }],
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Checkpoint controls', () => {
  it('C8 a checkpoint for another profile does not enter active history', async () => {
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([{ ...record('C8'), profileId: 'other' }])
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(get(durableHistory)).toEqual({})
  })
  it('C9 replaying the same cloud checkpoint is ignored', async () => {
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([record('C9')])
    expect(await syncCompanionProgress(device)).toBe(true)
    expect(await syncCompanionProgress(device)).toBe(false)
  })
})
describe('Checkpoint regression criteria', () => {
  it('E9 importing an old TV checkpoint should preserve actual viewing recency', async () => {
    const saved = record('E9')
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([saved])
    await syncCompanionProgress(device)
    expect(get(durableHistory)[-77].updatedAt).toBe(saved.updatedAt)
    expect(get(durablePositions)['-77:1'].updatedAt).toBe(saved.updatedAt)
  })
  it('E10 two season-relative episode-one checkpoints should retain distinct resume positions', async () => {
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([
      record('E10-season1', 1, 300), { ...record('E10-season2', 2, 600), updatedAt: now - 29 * 86400000 },
    ])
    await syncCompanionProgress(device)
    expect(Object.values(get(durablePositions)).map(p => p.pos).sort((a, b) => a - b)).toEqual([300, 600])
    expect(getPosition(-77, 1)).toBe(300)
    expect(getPosition(-77, 3)).toBe(600)
    expect(get(durableHistory)[-77].episode).toBe(3)
    expect(catalog.detail).toHaveBeenCalledTimes(1)
  })
  it('preserves a newer local resume point and history when an older TV record arrives', async () => {
    const saved = record('newer-local')
    durablePositions.set({ '-77:1': { pos: 900, dur: 1200, updatedAt: now } })
    durableHistory.set({ [-77]: { media: await catalog.detail(), progress: 2, episode: 2, updatedAt: now } })
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([saved])
    await syncCompanionProgress(device)
    expect(getPosition(-77, 1)).toBe(900)
    expect(get(durableHistory)[-77]).toMatchObject({ episode: 2, progress: 2, updatedAt: now })
  })
  it('maps specials through provider video numbers and preserves the completion clock', async () => {
    const saved = { ...record('special', 0), completed: true, updatedAt: now - 2 * 86400000 }
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([saved])
    await syncCompanionProgress(device)
    expect(get(durableHistory)[-77]).toMatchObject({ episode: 4, progress: 4, updatedAt: saved.updatedAt })
    expect(get(durablePositions)['-77:4']).toMatchObject({ pos: 0, cleared: true, updatedAt: saved.updatedAt })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('marks a completed movie finished even when the compact checkpoint has no episode count', async () => {
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([{ ...record('movie'), completed: true,
      media: { ref: { provider: 'tmdb', type: 'movie', id: '77' }, mediaId: -78, title: 'Movie fixture' } }])
    await syncCompanionProgress(device)
    expect(get(durableHistory)[-78].progress).toBe(1)
    expect(get(localLibrary).entries['tmdb:movie:77'].tracking?.status).toBe('COMPLETED')
    expect(catalog.detail).not.toHaveBeenCalled()
  })
  it('retries an unresolved season checkpoint after metadata becomes available', async () => {
    catalog.detail.mockRejectedValueOnce(new Error('Offline'))
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([record('retry', 2)])
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(get(durablePositions)).toEqual({})
    expect(get(durableHistory)).toEqual({})
    expect(await syncCompanionProgress(device)).toBe(true)
    expect(getPosition(-77, 3)).toBe(300)
  })
  it('rejects a catalog response for the wrong title', async () => {
    catalog.detail.mockResolvedValueOnce({ ...await catalog.detail(), catalog: { provider: 'tmdb', type: 'series', id: '88' } })
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([record('wrong-title')])
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(get(durableHistory)).toEqual({})
  })
  it('does not apply a checkpoint when profile selection starts during metadata hydration', async () => {
    let finish!: (value: unknown) => void
    const media = await catalog.detail()
    catalog.detail.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    vi.mocked(readCloudflareCompanionProgress).mockResolvedValue([record('profile-during-detail')])
    const pending = syncCompanionProgress(device)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    profileSwitcherOpen.set(true)
    finish(media)
    expect(await pending).toBe(false)
    expect(get(durableHistory)).toEqual({})
  })
})
