import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudflareSyncConfig, companionTransportForLan, createCloudflareCompanionPairing, saveCloudflareCompanionRecovery, type CloudflareCompanionTransport } from './cloudflare'

const endpoint = 'https://private.example.workers.dev'
const groupKey = btoa('g'.repeat(32)).replace(/=/g, '')
const transport: CloudflareCompanionTransport = {
  protocol: 1, endpoint, pairingId: 'companion_pairing_123456',
  tvToken: btoa('t'.repeat(32)).replace(/=/g, ''), playbackMode: 'cloud-only', wakeWhenClosed: false,
  recoveryKey: btoa('r'.repeat(32)).replace(/=/g, ''),
}
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
function configure() {
  cloudflareSyncConfig.set({ enabled: true, endpoint, deviceId: 'device_1234567890123456', deviceToken: 'D'.repeat(43), groupKey, workerVersion: '1.11.0' })
}
const status = (supported = true) => new Response(JSON.stringify({ app: 'izumi-sync', protocol: 1, version: '1.11.0', claimed: true,
  features: ['companion-wake-v1', ...(supported ? ['companion-client-link-v1'] : [])] }))

afterEach(() => vi.unstubAllGlobals())

describe('TV sync-key recovery provisioning', () => {
  it('stores only ciphertext and authenticates with the full client credential', async () => {
    configure()
    const fetch = vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetch)
    expect(await saveCloudflareCompanionRecovery(transport)).toBe(true)
    const [url, init] = fetch.mock.calls[1]
    expect(url).toBe(`${endpoint}/v1/companion/pairings/${transport.pairingId}/client-recovery`)
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${'D'.repeat(43)}`)
    expect(init.body).not.toContain(groupKey)
    expect(init.body).not.toContain(transport.tvToken)
    expect(init.body).not.toContain(transport.recoveryKey)
    const envelope = JSON.parse(JSON.parse(init.body).payload)
    const key = await crypto.subtle.importKey('raw', bytes(transport.recoveryKey!), 'AES-GCM', false, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv),
      additionalData: new TextEncoder().encode(`izumi-companion:${transport.pairingId}:client-recovery`) }, key, bytes(envelope.data))
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual({ v: 1, groupKey })
    const bearerKey = await crypto.subtle.importKey('raw', bytes(transport.tvToken), 'AES-GCM', false, ['decrypt'])
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv),
      additionalData: new TextEncoder().encode(`izumi-companion:${transport.pairingId}:client-recovery`) }, bearerKey, bytes(envelope.data))).rejects.toThrow()
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv),
      additionalData: new TextEncoder().encode(`izumi-companion:another_pairing:client-recovery`) }, key, bytes(envelope.data))).rejects.toThrow()
  })

  it('leaves older Workers usable and never sends a key to a different Worker', async () => {
    configure()
    const fetch = vi.fn().mockResolvedValueOnce(status(false))
    vi.stubGlobal('fetch', fetch)
    expect(await saveCloudflareCompanionRecovery(transport)).toBe(false)
    expect(await saveCloudflareCompanionRecovery({ ...transport, endpoint: 'https://other.example' })).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never provisions or sends a recovery secret over ordinary LAN pairing', async () => {
    configure()
    const fetch = vi.fn().mockResolvedValueOnce(status()).mockResolvedValueOnce(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetch)
    expect(await createCloudflareCompanionPairing()).not.toHaveProperty('recoveryKey')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(companionTransportForLan(transport)).not.toHaveProperty('recoveryKey')
    expect(transport.recoveryKey).toBeDefined()
  })

  it.each(['same', 'different', 'unreadable'] as const)('verifies a previously stored %s backup before reporting success', async (backup) => {
    configure()
    let uploaded = ''
    const fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return status()
      if (init.method === 'PUT') {
        uploaded = JSON.parse(init.body as string).payload
        if (backup === 'different') {
          const iv = crypto.getRandomValues(new Uint8Array(12))
          const key = await crypto.subtle.importKey('raw', bytes(transport.recoveryKey!), 'AES-GCM', false, ['encrypt'])
          const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
            additionalData: new TextEncoder().encode(`izumi-companion:${transport.pairingId}:client-recovery`) }, key,
            new TextEncoder().encode(JSON.stringify({ v: 1, groupKey: 'Z'.repeat(43) })))
          const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
          uploaded = JSON.stringify({ v: 1, iv: encode(iv), data: encode(new Uint8Array(data)) })
        }
        return new Response('{"ok":true,"stored":false}')
      }
      return new Response(JSON.stringify({ payload: backup === 'unreadable' ? 'invalid' : uploaded }))
    })
    vi.stubGlobal('fetch', fetch)
    if (backup === 'same') expect(await saveCloudflareCompanionRecovery(transport)).toBe(true)
    else await expect(saveCloudflareCompanionRecovery(transport)).rejects.toThrow('existing backup was preserved')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
