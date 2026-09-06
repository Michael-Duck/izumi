import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import { createNuvioClient, NUVIO_BACKEND, NUVIO_PUBLIC_KEY, NUVIO_WEBSITE, NuvioHttpError, type NuvioSession, type DeviceCode } from './auth'

vi.mock('$lib/profiles/store', async () => ({ profiledPersisted: (await import('svelte/store')).writable.bind(null, null) }))
const tokenReply = { access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600, user: { id: 'viewer', email: 'viewer@example.test' } }
const oldSession = (): NuvioSession => ({ accessToken: 'access-old', refreshToken: 'refresh-old', expiresAt: Date.now() + 300_000, userId: 'viewer', email: 'viewer@example.test' })
function setup(signedIn = true) {
  const session = writable<NuvioSession | null>(signedIn ? oldSession() : null)
  const transport = vi.fn<Parameters<typeof createNuvioClient>[1] & {}>()
  return { session, transport, client: createNuvioClient(session, transport) }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Nuvio account sessions', () => {
  it('uses the documented publishable key without an anonymous bearer token', async () => {
    const { client, transport } = setup(false); transport.mockResolvedValue(true)
    await client.publicRequest('backend', '/rest/v1/rpc/health_ping', {})
    expect(NUVIO_PUBLIC_KEY).toMatch(/^sb_publishable_/)
    expect(transport.mock.calls[0][1]).toMatchObject({ apikey: NUVIO_PUBLIC_KEY })
    expect(transport.mock.calls[0][1]).not.toHaveProperty('Authorization')
  })
  it('handles signup email confirmation without inventing a session', async () => {
    const { client, transport, session } = setup(false); transport.mockResolvedValue({ id: 'user', email: 'viewer@example.test' })
    expect(await client.signUp(' viewer@example.test ', 'password')).toBe('confirm-email')
    expect(get(session)).toBeNull()
    expect(transport.mock.calls[0][0]).toBe(`${NUVIO_BACKEND}/auth/v1/signup`)
    expect(transport.mock.calls[0][2]).toEqual({ email: 'viewer@example.test', password: 'password' })
  })
  it('accepts an immediate signup session and discards cancelled responses', async () => {
    const { client, transport, session } = setup(false); transport.mockResolvedValue(tokenReply)
    expect(await client.signUp('viewer@example.test', 'password')).toBe('connected')
    expect(get(session)?.userId).toBe('viewer')
    const abort = new AbortController(); abort.abort()
    await expect(client.signUp('viewer@example.test', 'password', abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('sends credentials only to the auth endpoint and saves tokens, not passwords', async () => {
    const { client, transport, session } = setup(false)
    transport.mockResolvedValue(tokenReply)
    await client.signIn(' viewer@example.test ', 'private-password')
    expect(transport).toHaveBeenCalledWith(`${NUVIO_BACKEND}/auth/v1/token?grant_type=password`, expect.objectContaining({ apikey: NUVIO_PUBLIC_KEY }), { email: 'viewer@example.test', password: 'private-password' }, undefined)
    expect(get(session)).toMatchObject({ accessToken: 'access-new', userId: 'viewer' })
    expect(JSON.stringify(get(session))).not.toContain('private-password')
  })
  it('coalesces expired-session refreshes before simultaneous API requests', async () => {
    const { client, transport, session } = setup()
    session.set({ ...oldSession(), expiresAt: 0 })
    transport.mockImplementation(async (url) => url.includes('refresh_token') ? tokenReply : { items: [] })
    await Promise.all([client.request('website', '/api/covers'), client.request('website', '/api/community-collections')])
    expect(transport.mock.calls.filter(([url]) => url.includes('refresh_token'))).toHaveLength(1)
    for (const [, headers] of transport.mock.calls.filter(([url]) => url.startsWith(NUVIO_WEBSITE))) {
      expect(headers.Authorization).toBe('Bearer access-new')
      expect(headers).not.toHaveProperty('apikey')
    }
  })
  it('refreshes once after a rejected access token and retries with the new token', async () => {
    const { client, transport } = setup()
    transport.mockRejectedValueOnce(new NuvioHttpError(401)).mockResolvedValueOnce(tokenReply).mockResolvedValueOnce({ items: ['ok'] })
    expect(await client.request('website', '/api/covers')).toEqual({ items: ['ok'] })
    expect(transport).toHaveBeenCalledTimes(3)
    expect(transport.mock.calls[2][1].Authorization).toBe('Bearer access-new')
  })
  it('clears an invalid refresh session, but retains it during a server outage', async () => {
    const { client, transport, session } = setup()
    session.set({ ...oldSession(), expiresAt: 0 })
    transport.mockRejectedValue(new NuvioHttpError(503))
    await expect(client.request('website', '/api/covers')).rejects.toThrow('503')
    expect(get(session)).not.toBeNull()
    transport.mockRejectedValue(new NuvioHttpError(400))
    await expect(client.request('website', '/api/covers')).rejects.toThrow('Reconnect')
    expect(get(session)).toBeNull()
  })
  it('does not resurrect a disconnected account when a pending refresh completes', async () => {
    const { client, transport, session } = setup()
    session.set({ ...oldSession(), expiresAt: 0 })
    let finish!: (value: unknown) => void
    transport.mockImplementation((url) => url.includes('refresh_token') ? new Promise((resolve) => finish = resolve) : Promise.resolve(null))
    const pending = client.request('website', '/api/covers')
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    client.disconnect(); finish(tokenReply)
    await rejected
    expect(get(session)).toBeNull()
    expect(transport.mock.calls.some(([url]) => url.endsWith('/auth/v1/logout?scope=local'))).toBe(true)
    expect(transport.mock.calls.some(([url]) => url.endsWith('/api/covers'))).toBe(false)
  })
  it('never sends an account token to a foreign origin', async () => {
    const { client, transport } = setup()
    await expect(client.request('website', '//attacker.test/api')).rejects.toThrow('Invalid')
    await expect(client.request('backend', 'https://attacker.test')).rejects.toThrow('Invalid')
    expect(transport).not.toHaveBeenCalled()
  })
  it('ignores a password sign-in that completes after cancellation', async () => {
    const { client, transport, session } = setup(false)
    let finish!: (value: unknown) => void
    transport.mockImplementation(() => new Promise((resolve) => finish = resolve))
    const abort = new AbortController()
    const pending = client.signIn('viewer@example.test', 'password', abort.signal)
    abort.abort(); finish(tokenReply)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(get(session)).toBeNull()
  })
})

describe('Nuvio browser approval', () => {
  const startReply = [{ device_code: 'device-secret', user_code: 'abc123', verification_uri_complete: `${NUVIO_WEBSITE}/link?code=ABC123`, poll_interval_seconds: 2 }]
  it('polls with the same nonce and exchanges only after approval', async () => {
    const { client, transport, session } = setup(false)
    const states: DeviceCode[] = []
    transport.mockResolvedValueOnce(startReply).mockResolvedValueOnce([{ status: 'pending' }]).mockResolvedValueOnce([{ status: 'approved' }]).mockResolvedValueOnce(tokenReply)
    const pending = client.connectDevice((value) => states.push(value))
    await vi.advanceTimersByTimeAsync(4000)
    await pending
    expect(states.map((state) => [state.code, state.completing])).toEqual([['ABC-123', false], ['ABC-123', true]])
    const nonce = (transport.mock.calls[0][2] as Record<string, unknown>).p_device_nonce
    expect(transport.mock.calls[1][2]).toEqual({ p_code: 'device-secret', p_device_nonce: nonce })
    expect(transport.mock.calls[3][2]).toEqual({ code: 'device-secret', device_nonce: nonce })
    expect(get(session)?.userId).toBe('viewer')
    expect(JSON.stringify(get(session))).not.toContain('device-secret')
  })
  it('cancels polling immediately when the user leaves the sign-in flow', async () => {
    const { client, transport, session } = setup(false)
    transport.mockResolvedValue(startReply)
    const abort = new AbortController()
    const pending = client.connectDevice(() => {}, abort.signal)
    await vi.advanceTimersByTimeAsync(0)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort(); await rejected
    await vi.advanceTimersByTimeAsync(10000)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(get(session)).toBeNull()
  })
  it('reports expired codes without exchanging or saving a session', async () => {
    const { client, transport, session } = setup(false)
    transport.mockResolvedValueOnce(startReply).mockResolvedValueOnce([{ status: 'expired' }])
    const pending = expect(client.connectDevice(() => {})).rejects.toThrow('expired')
    await vi.advanceTimersByTimeAsync(2000); await pending
    expect(transport).toHaveBeenCalledTimes(2)
    expect(get(session)).toBeNull()
  })
  it('rejects verification links outside Nuvio before displaying or polling them', async () => {
    const { client, transport } = setup(false)
    transport.mockResolvedValue([{ ...startReply[0], verification_uri_complete: 'https://attacker.test/link' }])
    const update = vi.fn()
    await expect(client.connectDevice(update)).rejects.toThrow('invalid sign-in link')
    expect(update).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
