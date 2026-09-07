import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { activeProfileLocked, profileSwitcherOpen, type ProfileState } from '$lib/profiles/store'
import { pullWatchProgress, pushWatchProgress } from '$lib/sync/client'
import { syncCompanionProgress, type PairedCompanion } from './client'
import { readCloudflareCompanionProgress } from '$lib/sync/cloudflare'
import { setCompanionRestorePending } from './restore-state'

vi.mock('$lib/sync/cloudflare', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/sync/cloudflare')>(),
  readCloudflareDiscoveryChoices: vi.fn().mockResolvedValue([]),
  readCloudflareCompanionProgress: vi.fn(),
}))
const household = persisted<ProfileState>('izumi-profiles-v1', { profiles: [] })
const original = get(household)
const device: PairedCompanion = { deviceId: 'ab'.repeat(12), name: 'TV', address: '', credential: 'ab'.repeat(32), pairedAt: 1,
  cloudflare: { protocol: 1, endpoint: 'https://private.example', pairingId: 'pairing_1234567890', tvToken: 'T'.repeat(43), playbackMode: 'cloud-only', wakeWhenClosed: false } }

beforeEach(() => { household.set(original); profileSwitcherOpen.set(false); setCompanionRestorePending(false); vi.clearAllMocks() })
afterEach(() => { household.set(original); profileSwitcherOpen.set(false); setCompanionRestorePending(false) })

describe('restored profile authorization during background sync', () => {
  it('keeps unlocked clients paused until their pending restore finishes', async () => {
    setCompanionRestorePending(true)
    expect(get(activeProfileLocked)).toBe(false)
    expect(await pushWatchProgress()).toBe(false)
    expect(await pullWatchProgress()).toBe(0)
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(readCloudflareCompanionProgress).not.toHaveBeenCalled()
  })
  it('does not read or write progress while the profile picker is open', async () => {
    profileSwitcherOpen.set(true)
    expect(await pushWatchProgress()).toBe(false)
    expect(await pullWatchProgress()).toBe(0)
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(readCloudflareCompanionProgress).not.toHaveBeenCalled()
  })
  it('does not read or write progress under a restored locked profile', async () => {
    household.set({ ...original, profiles: original.profiles.map(p => ({ ...p, pin: { salt: 'restored-salt', hash: 'restored-hash' } })) })
    expect(get(activeProfileLocked)).toBe(true)
    expect(await pushWatchProgress()).toBe(false)
    expect(await pullWatchProgress()).toBe(0)
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(readCloudflareCompanionProgress).not.toHaveBeenCalled()
  })
  it.each(['picker', 'restore'])('discards an in-flight TV checkpoint when %s starts', async (reason) => {
    let finish!: (records: Awaited<ReturnType<typeof readCloudflareCompanionProgress>>) => void
    vi.mocked(readCloudflareCompanionProgress).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const pending = syncCompanionProgress(device)
    await vi.waitFor(() => expect(readCloudflareCompanionProgress).toHaveBeenCalledOnce())
    if (reason === 'picker') profileSwitcherOpen.set(true)
    else setCompanionRestorePending(true)
    finish([{ recordKey: 'checkpoint', media: { ref: { provider: 'anilist', type: 'anime', id: '21' }, title: 'Saved title', episode: 1 },
      sessionId: 'saved', positionSeconds: 600, durationSeconds: 1400, state: 'paused', completed: false, updatedAt: Date.now() }])
    expect(await pending).toBe(false)
  })
})
