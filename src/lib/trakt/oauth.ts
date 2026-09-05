export const TRAKT_SITE_REDIRECT_URI = 'https://izumi.watch/link/trakt'
export const TRAKT_AUTH_TTL_MS = 10 * 60_000
export interface TraktAuthorization {
  state: string
  verifier: string
  createdAt: number
  profileId: string
  clientId: string
  redirectUri: typeof TRAKT_SITE_REDIRECT_URI
}
export type TraktCallback = { state: string; code?: string; error?: string }

export function isTraktCallbackLink(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'izumi:' && url.hostname === 'auth' && url.pathname === '/trakt'
      && !url.username && !url.password && !url.port && !url.search
  } catch { return false }
}
export function parseTraktCallback(raw: string): TraktCallback | null {
  if (raw.length > 4096 || !isTraktCallbackLink(raw)) return null
  const params = new URLSearchParams(new URL(raw).hash.slice(1))
  if (params.getAll('state').length !== 1 || !/^[a-f0-9]{64}$/.test(params.get('state') ?? '')) return null
  if ([...params.keys()].some((key) => !['state', 'code', 'error'].includes(key))) return null
  const state = params.get('state')!
  if (params.getAll('code').length === 1 && !params.has('error') && /^[A-Za-z0-9._~-]{1,2048}$/.test(params.get('code') ?? '')) return { state, code: params.get('code')! }
  if (!params.has('code') && params.getAll('error').length === 1 && ['access_denied', 'authorization_failed'].includes(params.get('error') ?? '')) return { state, error: params.get('error')! }
  return null
}
function randomHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function createTraktAuthorization(clientId: string, profileId: string, now = Date.now()) {
  const pending: TraktAuthorization = { state: randomHex(), verifier: randomHex(), createdAt: now, profileId, clientId, redirectUri: TRAKT_SITE_REDIRECT_URI }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier)))
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const url = new URL('https://auth.trakt.tv/oauth/authorize')
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: pending.redirectUri, state: pending.state, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
  return { pending, url: url.toString() }
}
export function validTraktAuthorization(value: unknown, profileId: string, clientId: string, now = Date.now()): value is TraktAuthorization {
  const item = value as Partial<TraktAuthorization> | null
  return Boolean(item && item.profileId === profileId && item.clientId === clientId && item.redirectUri === TRAKT_SITE_REDIRECT_URI
    && /^[a-f0-9]{64}$/.test(item.state ?? '') && /^[a-f0-9]{64}$/.test(item.verifier ?? '')
    && typeof item.createdAt === 'number' && item.createdAt <= now && now - item.createdAt < TRAKT_AUTH_TTL_MS)
}
