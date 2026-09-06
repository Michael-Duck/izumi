import { get, type Writable } from 'svelte/store'
import { profiledPersisted } from '$lib/profiles/store'
import { invokeNativeHttp } from '$lib/net/http'
import packageJson from '../../../package.json'

export const NUVIO_BACKEND = 'https://api.nuvio.tv'
export const NUVIO_WEBSITE = 'https://nuvio.tv'
// Public client key from nuvio.tv/docs, API v1.3. It is not an access token.
export const NUVIO_PUBLIC_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN'

export interface NuvioSession { accessToken: string; refreshToken: string; expiresAt: number; userId: string; email: string }
export interface DeviceCode { code: string; url: string; completing: boolean }
export type NuvioTransport = (url: string, headers: Record<string, string>, body?: unknown, signal?: AbortSignal) => Promise<unknown>
export class NuvioHttpError extends Error {
  constructor(public status: number) {
    super(status === 401 || status === 403 ? 'Your Nuvio session was not accepted. Reconnect your account to continue.'
      : status === 429 ? 'Nuvio is receiving too many requests. Wait a moment and try again.'
        : status === 404 ? 'This item is no longer available on Nuvio.' : `Nuvio could not complete the request (HTTP ${status}). Try again.`)
  }
}
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const first = (value: unknown): unknown => Array.isArray(value) ? value[0] : value
export const string = (value: unknown): string => typeof value === 'string' ? value : ''

export const nuvioTransport: NuvioTransport = async (url, headers, body, signal) => {
  const reply = await invokeNativeHttp<{ status: number; body: string }>('ext_fetch', {
    url, method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { signal, timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 })
  if (reply.status < 200 || reply.status >= 300) throw new NuvioHttpError(reply.status)
  if (!reply.body) return null
  try { return JSON.parse(reply.body) } catch { throw new Error('Nuvio returned an unreadable response. Try again later.') }
}

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Sign-in cancelled', 'AbortError')
}
function delay(ms: number, signal?: AbortSignal) {
  cancelled(signal)
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Sign-in cancelled', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** The native Nuvio device-link protocol, with profile-local sessions and a single refresh flight. */
export function createNuvioClient(session: Writable<NuvioSession | null>, transport: NuvioTransport = nuvioTransport) {
  let generation = 0
  let refreshing: { token: string; promise: Promise<NuvioSession> } | undefined
  const headers = (token?: string, backend = true) => ({
    ...(backend ? { apikey: NUVIO_PUBLIC_KEY } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json', 'X-Client-Info': `Izumi/${packageJson.version}`,
  })
  const auth = (path: string, body?: unknown, signal?: AbortSignal, token?: string) => transport(`${NUVIO_BACKEND}${path}`, headers(token), body, signal)
  const assertCurrent = (epoch: number, signal?: AbortSignal) => {
    cancelled(signal)
    if (epoch !== generation) throw new DOMException('Account connection changed', 'AbortError')
  }
  async function accept(value: unknown, epoch: number, signal?: AbortSignal): Promise<NuvioSession> {
    assertCurrent(epoch, signal)
    const raw = object(value)
    const accessToken = string(raw.access_token), refreshToken = string(raw.refresh_token)
    const expiresIn = Number(raw.expires_in)
    if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Nuvio returned an incomplete session. Try signing in again.')
    const user = raw.user ? object(raw.user) : object(await auth('/auth/v1/user', undefined, signal, accessToken))
    if (!string(user.id)) throw new Error('Nuvio could not identify this account. Try signing in again.')
    assertCurrent(epoch, signal)
    const result = { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000, userId: string(user.id), email: string(user.email) }
    session.set(result)
    return result
  }
  async function refresh(previous: NuvioSession): Promise<NuvioSession> {
    const current = get(session)
    if (!current) throw new NuvioHttpError(401)
    if (current.refreshToken !== previous.refreshToken) return current
    if (refreshing?.token === previous.refreshToken) return refreshing.promise
    const epoch = generation
    const promise = (async () => {
      try { return await accept(await auth('/auth/v1/token?grant_type=refresh_token', { refresh_token: previous.refreshToken }), epoch) }
      catch (error) {
        if (epoch === generation && get(session)?.refreshToken === previous.refreshToken && error instanceof NuvioHttpError && [400, 401, 403].includes(error.status)) {
          generation++; session.set(null)
          throw new NuvioHttpError(401)
        }
        throw error
      }
    })()
    refreshing = { token: previous.refreshToken, promise }
    try { return await promise } finally { if (refreshing?.promise === promise) refreshing = undefined }
  }
  async function request(service: 'backend' | 'website', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const base = service === 'backend' ? NUVIO_BACKEND : NUVIO_WEBSITE
    const url = new URL(path, base)
    if (url.origin !== base || !path.startsWith('/') || url.username || url.password) throw new Error('Invalid Nuvio API address.')
    const epoch = generation
    let current = get(session)
    if (!current) throw new NuvioHttpError(401)
    if (current.expiresAt < Date.now() + 60_000) current = await refresh(current)
    assertCurrent(epoch, signal)
    try {
      const result = await transport(url.href, headers(current.accessToken, service === 'backend'), body, signal)
      assertCurrent(epoch, signal)
      return result
    } catch (error) {
      if (!(error instanceof NuvioHttpError) || error.status !== 401) throw error
      assertCurrent(epoch, signal)
      current = await refresh(current)
      assertCurrent(epoch, signal)
      const result = await transport(url.href, headers(current.accessToken, service === 'backend'), body, signal)
      assertCurrent(epoch, signal)
      return result
    }
  }
  async function signIn(email: string, password: string, signal?: AbortSignal) {
    const epoch = ++generation
    try { await accept(await auth('/auth/v1/token?grant_type=password', { email: email.trim(), password }, signal), epoch, signal) }
    catch (error) {
      if (error instanceof NuvioHttpError && [400, 401, 422].includes(error.status)) throw new Error('Email or password was not accepted by Nuvio.')
      throw error
    }
  }
  async function signUp(email: string, password: string, signal?: AbortSignal): Promise<'connected' | 'confirm-email'> {
    const epoch = ++generation
    const result = object(await auth('/auth/v1/signup', { email: email.trim(), password }, signal))
    assertCurrent(epoch, signal)
    if (!result.access_token) return 'confirm-email'
    await accept(result, epoch, signal)
    return 'connected'
  }
  function publicRequest(service: 'backend' | 'website', path: string, body?: unknown, signal?: AbortSignal) {
    const base = service === 'backend' ? NUVIO_BACKEND : NUVIO_WEBSITE
    const url = new URL(path, base)
    if (url.origin !== base || !path.startsWith('/') || url.username || url.password) throw new Error('Invalid Nuvio API address.')
    return transport(url.href, headers(undefined, service === 'backend'), body, signal)
  }
  async function connectDevice(update: (code: DeviceCode) => void, signal?: AbortSignal) {
    const epoch = ++generation
    const nonce = crypto.randomUUID()
    const raw = object(first(await auth('/rest/v1/rpc/start_device_login_session', {
      p_device_nonce: nonce, p_redirect_base_url: `${NUVIO_WEBSITE}/link`, p_device_name: 'Izumi',
      // Nuvio's non-TV device-link flow uses the mobile protocol category.
      p_device_type: 'mobile',
    }, signal)))
    assertCurrent(epoch, signal)
    const deviceCode = string(raw.device_code), code = string(raw.user_code).toUpperCase().replace(/[^A-Z0-9]/g, '')
    let url: URL
    try { url = new URL(string(raw.verification_uri_complete)) } catch { throw new Error('Nuvio could not create a sign-in link. Try again.') }
    if (!deviceCode || code.length !== 6 || url.origin !== NUVIO_WEBSITE || url.pathname !== '/link' || url.username || url.password) throw new Error('Nuvio returned an invalid sign-in link. Try again later.')
    const state = { code: `${code.slice(0, 3)}-${code.slice(3)}`, url: url.href, completing: false }
    update(state)
    const interval = Math.max(2, Math.min(10, Number(raw.poll_interval_seconds) || 3)) * 1000
    let failures = 0
    for (let attempt = 0; attempt < 120; attempt++) {
      await delay(interval, signal)
      assertCurrent(epoch, signal)
      let poll: Record<string, unknown>
      try {
        poll = object(first(await auth('/rest/v1/rpc/poll_tv_login_session', { p_code: deviceCode, p_device_nonce: nonce }, signal)))
        failures = 0
      } catch (error) { assertCurrent(epoch, signal); if (++failures >= 3) throw error; continue }
      assertCurrent(epoch, signal)
      if (poll.status === 'pending') continue
      if (poll.status !== 'approved') throw new Error('This sign-in code expired. Get a new code to try again.')
      update({ ...state, completing: true })
      await accept(await auth('/functions/v1/tv-logins-exchange', { code: deviceCode, device_nonce: nonce }, signal), epoch, signal)
      return
    }
    throw new Error('This sign-in code expired. Get a new code to try again.')
  }
  function disconnect() {
    const previous = get(session)
    generation++
    session.set(null)
    // Local scope revokes this session only. Other Nuvio devices stay signed in.
    if (previous) void auth('/auth/v1/logout?scope=local', {}, undefined, previous.accessToken).catch(() => {})
  }
  return { session, request, publicRequest, signIn, signUp, connectDevice, disconnect }
}

export const nuvioSession = profiledPersisted<NuvioSession | null>('nuvio-auth-tokens-v1', null)
export const nuvioClient = createNuvioClient(nuvioSession)
