// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(), fetch: vi.fn(), save: vi.fn(), viewer: vi.fn(), flush: vi.fn(),
  credentials: { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'urn:ietf:wg:oauth:2.0:oob' },
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }))
vi.mock('$lib/profiles/store', async () => {
  const { writable } = await import('svelte/store')
  return { activeProfileId: writable('profile-a'), profileStorageKey: (key: string, id: string) => `${id}:${key}` }
})
vi.mock('./config', async () => {
  const { writable } = await import('svelte/store')
  return { traktRedirectUri: writable(mocks.credentials.redirectUri) }
})
vi.mock('./client', () => ({
  traktCredentials: () => mocks.credentials, traktOAuthFetch: mocks.fetch,
  saveTraktToken: mocks.save, refreshTraktViewer: mocks.viewer,
}))
vi.mock('./sync', () => ({ flushTraktSyncQueue: mocks.flush }))

import { activeProfileId } from '$lib/profiles/store'
import { traktRedirectUri } from './config'
import { cancelTraktBrowserAuth, completeTraktBrowserAuth, startTraktBrowserAuth, traktBrowserAuth } from './browser-auth'
import { TRAKT_AUTH_TTL_MS, TRAKT_SITE_REDIRECT_URI, type TraktAuthorization } from './oauth'

const storageKey = 'profile-a:trakt-browser-auth-v1'
const reply = { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, created_at: 1000 }
const callback = (state: string) => `izumi://auth/trakt#state=${state}&code=test-code`
const pending = () => JSON.parse(localStorage.getItem(storageKey)!) as TraktAuthorization
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('native Trakt browser connection', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto)
    cancelTraktBrowserAuth()
    localStorage.clear()
    vi.clearAllMocks()
    mocks.credentials.clientId = 'test-client'
    mocks.credentials.clientSecret = 'test-secret'
    activeProfileId.set('profile-a')
    traktRedirectUri.set(mocks.credentials.redirectUri)
    mocks.openUrl.mockResolvedValue(undefined)
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(reply)))
    mocks.viewer.mockResolvedValue(undefined)
  })
  afterEach(() => { cancelTraktBrowserAuth(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('opens the website-based flow and exchanges once using its original redirect and verifier', async () => {
    await startTraktBrowserAuth()
    const request = pending()
    expect(request.profileId).toBe('profile-a')
    expect(JSON.stringify(request)).not.toContain('test-secret')
    expect(new URL(mocks.openUrl.mock.calls[0][0]).searchParams.get('redirect_uri')).toBe(TRAKT_SITE_REDIRECT_URI)
    expect(get(traktRedirectUri)).toBe(mocks.credentials.redirectUri)
    await completeTraktBrowserAuth(callback(request.state))
    const [path, init] = mocks.fetch.mock.calls[0]
    expect(path).toBe('/oauth/token')
    expect(JSON.parse(init.body)).toEqual({ client_id: 'test-client', client_secret: 'test-secret', redirect_uri: TRAKT_SITE_REDIRECT_URI, code: 'test-code', code_verifier: request.verifier, grant_type: 'authorization_code' })
    expect(mocks.save).toHaveBeenCalledWith(reply)
    expect(get(traktRedirectUri)).toBe(TRAKT_SITE_REDIRECT_URI)
    expect(get(traktBrowserAuth).phase).toBe('connected')
    expect(localStorage.getItem(storageKey)).toBeNull()
    await expect(completeTraktBrowserAuth(callback(request.state))).rejects.toThrow('expired')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a mismatched state without destroying the real pending transaction', async () => {
    await startTraktBrowserAuth()
    const request = pending()
    await expect(completeTraktBrowserAuth(callback('0'.repeat(64)))).rejects.toThrow('another sign-in')
    expect(pending()).toEqual(request)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects expired transactions even if the expiry timer has not fired', async () => {
    await startTraktBrowserAuth()
    const request = pending()
    localStorage.setItem(storageKey, JSON.stringify({ ...request, createdAt: Date.now() - TRAKT_AUTH_TTL_MS }))
    await expect(completeTraktBrowserAuth(callback(request.state))).rejects.toThrow('expired')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('expires the waiting UI and removes the verifier', async () => {
    vi.useFakeTimers()
    await startTraktBrowserAuth()
    await vi.advanceTimersByTimeAsync(TRAKT_AUTH_TTL_MS)
    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(get(traktBrowserAuth)).toMatchObject({ phase: 'error', message: expect.stringContaining('expired') })
  })

  it('does not connect after switching profiles or changing client registrations', async () => {
    await startTraktBrowserAuth()
    const link = callback(pending().state)
    activeProfileId.set('profile-b')
    await expect(completeTraktBrowserAuth(link)).rejects.toThrow('profile')
    activeProfileId.set('profile-a')
    mocks.credentials.clientId = 'different-client'
    await expect(completeTraktBrowserAuth(link)).rejects.toThrow('another sign-in')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('consumes a declined request without contacting the token endpoint', async () => {
    await startTraktBrowserAuth()
    await expect(completeTraktBrowserAuth(`izumi://auth/trakt#state=${pending().state}&error=access_denied`)).rejects.toThrow('cancelled')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('coalesces duplicate returns while an exchange is in flight', async () => {
    await startTraktBrowserAuth()
    const link = callback(pending().state)
    const response = deferred<Response>()
    mocks.fetch.mockReturnValue(response.promise)
    const first = completeTraktBrowserAuth(link)
    const second = completeTraktBrowserAuth(link)
    response.resolve(new Response(JSON.stringify(reply)))
    await Promise.all([first, second])
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it.each(['cancel', 'switch'] as const)('does not save a late token response after %s', async (action) => {
    await startTraktBrowserAuth()
    const response = deferred<Response>()
    mocks.fetch.mockReturnValue(response.promise)
    const completion = completeTraktBrowserAuth(callback(pending().state))
    const rejected = expect(completion).rejects.toMatchObject({ name: 'AbortError' })
    if (action === 'cancel') cancelTraktBrowserAuth()
    else activeProfileId.set('profile-b')
    response.resolve(new Response(JSON.stringify(reply)))
    await rejected
    expect(mocks.save).not.toHaveBeenCalled()
    expect(get(traktRedirectUri)).toBe(mocks.credentials.redirectUri)
  })

  it('can cancel before PKCE generation finishes without opening a browser', async () => {
    const attempt = startTraktBrowserAuth()
    const rejected = expect(attempt).rejects.toMatchObject({ name: 'AbortError' })
    cancelTraktBrowserAuth()
    await rejected
    expect(mocks.openUrl).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(get(traktBrowserAuth).phase).toBe('idle')
  })

  it('cleans up when browser launch fails and allows retry', async () => {
    mocks.openUrl.mockRejectedValueOnce(new Error('native failure'))
    await expect(startTraktBrowserAuth()).rejects.toThrow('Could not start')
    expect(localStorage.getItem(storageKey)).toBeNull()
    await startTraktBrowserAuth()
    expect(get(traktBrowserAuth).phase).toBe('waiting')
  })

  it.each([null, {}, { ...reply, access_token: 42 }, { ...reply, expires_in: -1 }, { ...reply, created_at: 'invalid' }])('rejects malformed token responses: %j', async (body) => {
    await startTraktBrowserAuth()
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(body)))
    await expect(completeTraktBrowserAuth(callback(pending().state))).rejects.toThrow('incomplete session')
    expect(mocks.save).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('does not reflect provider error bodies or save a failed session', async () => {
    await startTraktBrowserAuth()
    mocks.fetch.mockResolvedValue(new Response('private-provider-error', { status: 400 }))
    await expect(completeTraktBrowserAuth(callback(pending().state))).rejects.toThrow('Check the registered callback')
    expect(get(traktBrowserAuth).message).not.toContain('private-provider-error')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not reflect an invalid JSON token response in the error message', async () => {
    await startTraktBrowserAuth()
    mocks.fetch.mockResolvedValue(new Response('private-token-response'))
    await expect(completeTraktBrowserAuth(callback(pending().state))).rejects.toThrow('incomplete session')
    expect(get(traktBrowserAuth).message).not.toContain('private-token-response')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('keeps a successful connection when viewer metadata is temporarily unavailable', async () => {
    await startTraktBrowserAuth()
    mocks.viewer.mockRejectedValueOnce(new Error('offline'))
    await completeTraktBrowserAuth(callback(pending().state))
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(get(traktBrowserAuth).phase).toBe('connected')
  })

  it('restores a pending transaction after module reload without changing its identity', async () => {
    await startTraktBrowserAuth()
    const request = pending()
    cancelTraktBrowserAuth()
    localStorage.setItem(storageKey, JSON.stringify(request))
    vi.resetModules()
    const restored = await import('./browser-auth')
    try {
      expect(get(restored.traktBrowserAuth).phase).toBe('waiting')
      await restored.completeTraktBrowserAuth(callback(request.state))
      expect(mocks.save).toHaveBeenCalledTimes(1)
    } finally { restored.cancelTraktBrowserAuth() }
  })
})
