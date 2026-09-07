import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { activeProfileLocked, profileSwitcherOpen } from '$lib/profiles/store'
import { pullWatchProgress, pushWatchProgress } from '$lib/sync/client'
import { readCloudflareCompanionProgress, readCloudflareDiscoveryChoices } from '$lib/sync/cloudflare'
import { syncCompanionProgress, type PairedCompanion } from './client'
import { companionRestorePending, setCompanionRestorePending } from './restore-state'

vi.mock('$lib/sync/cloudflare', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/sync/cloudflare')>(),
  readCloudflareDiscoveryChoices: vi.fn().mockResolvedValue([]),
  readCloudflareCompanionProgress: vi.fn().mockResolvedValue([]),
}))

const device: PairedCompanion = {
  deviceId: 'ab'.repeat(12), name: 'TV', address: '', credential: 'ab'.repeat(32), pairedAt: 1,
  cloudflare: { protocol: 1, endpoint: 'https://restore.example.com', pairingId: 'pairing_1234567890',
    tvToken: 'T'.repeat(43), playbackMode: 'cloud-only', wakeWhenClosed: false },
}

beforeEach(() => {
  setCompanionRestorePending(false)
  profileSwitcherOpen.set(false)
  vi.mocked(readCloudflareDiscoveryChoices).mockReset().mockResolvedValue([])
  vi.mocked(readCloudflareCompanionProgress).mockReset().mockResolvedValue([])
})
afterEach(() => { setCompanionRestorePending(false); profileSwitcherOpen.set(false) })

describe('durable restore barrier in the shared client guards', () => {
  it('blocks group push/pull and TV reads even with an unlocked profile and a closed picker', async () => {
    expect(get(activeProfileLocked)).toBe(false)
    expect(get(profileSwitcherOpen)).toBe(false)
    setCompanionRestorePending(true)
    expect(await pushWatchProgress()).toBe(false)
    expect(await pullWatchProgress()).toBe(0)
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(readCloudflareDiscoveryChoices).not.toHaveBeenCalled()
    expect(readCloudflareCompanionProgress).not.toHaveBeenCalled()
  })

  it('discards a checkpoint already in flight when a restore becomes pending', async () => {
    let finish!: (rows: Awaited<ReturnType<typeof readCloudflareCompanionProgress>>) => void
    vi.mocked(readCloudflareCompanionProgress).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const work = syncCompanionProgress(device)
    await vi.waitFor(() => expect(readCloudflareCompanionProgress).toHaveBeenCalledOnce())
    setCompanionRestorePending(true)
    finish([{ recordKey: 'pending-restore-checkpoint', profileId: 'default',
      media: { ref: { provider: 'anilist', type: 'anime', id: '21' }, title: 'Saved title', episode: 1 },
      sessionId: 'saved', positionSeconds: 600, durationSeconds: 1400, state: 'paused', completed: false, updatedAt: Date.now() }])
    expect(await work).toBe(false)
    expect(get(companionRestorePending)).toBe(true)
  })

  it('discards an in-flight discovery response and stops before reading checkpoints', async () => {
    let finish!: (rows: Awaited<ReturnType<typeof readCloudflareDiscoveryChoices>>) => void
    vi.mocked(readCloudflareDiscoveryChoices).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const work = syncCompanionProgress(device)
    await vi.waitFor(() => expect(readCloudflareDiscoveryChoices).toHaveBeenCalledOnce())
    setCompanionRestorePending(true)
    finish([{ profileId: 'default', action: 'save', at: Date.now(),
      media: { ref: { provider: 'anilist', type: 'anime', id: '21' }, title: 'Saved title' } }])
    expect(await work).toBe(false)
    expect(readCloudflareCompanionProgress).not.toHaveBeenCalled()
  })

  it('allows normal TV reads again after the durable finish clears the barrier', async () => {
    setCompanionRestorePending(true)
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(readCloudflareCompanionProgress).not.toHaveBeenCalled()
    setCompanionRestorePending(false)
    expect(await syncCompanionProgress(device)).toBe(false)
    expect(readCloudflareDiscoveryChoices).toHaveBeenCalledOnce()
    expect(readCloudflareCompanionProgress).toHaveBeenCalledOnce()
  })
})
