import { get } from 'svelte/store'
import { trackerHttpFetch } from '$lib/trackers/tracker-http'
import {
  traktClientId,
  traktClientSecret,
  traktAppClientId,
  traktRedirectUri,
  traktRefreshToken,
  traktToken,
  traktTokenExpiry,
  traktUserAvatar,
  traktUserName,
  traktUserSlug,
  TRAKT_DEVICE_REDIRECT_URI,
} from './config'
import type { TraktTokenReply } from './types'

const API = 'https://api.trakt.tv'
const AUTH = 'https://auth.trakt.tv'
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' }
const EXPIRY_MARGIN_MS = 60_000
let refreshInFlight: Promise<string> | null = null

export function traktCredentials() {
  return {
    clientId: get(traktClientId).trim() || traktAppClientId,
    clientSecret: get(traktClientSecret).trim(),
    redirectUri: get(traktRedirectUri).trim() || TRAKT_DEVICE_REDIRECT_URI,
  }
}

export function clearTraktSession() {
  traktToken.set(null)
  traktRefreshToken.set(null)
  traktTokenExpiry.set(0)
  traktUserName.set('')
  traktUserSlug.set('')
  traktUserAvatar.set('')
}

export function saveTraktToken(reply: TraktTokenReply) {
  // Trakt refresh tokens are single-use. Persist the replacement before any future request.
  traktRefreshToken.set(reply.refresh_token)
  traktToken.set(reply.access_token)
  const createdAtMs = (reply.created_at || Math.floor(Date.now() / 1_000)) * 1_000
  traktTokenExpiry.set(createdAtMs + Math.max(0, reply.expires_in) * 1_000)
}

export async function traktOAuthFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return trackerHttpFetch(`${AUTH}${path}`, {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  }, 'Trakt')
}

async function tokenError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { error?: string; error_description?: string }
  return new Error(body.error_description || body.error || `${fallback} (${response.status})`)
}

export async function refreshTraktToken(force = false): Promise<string> {
  const accessToken = get(traktToken)
  if (!force && accessToken && get(traktTokenExpiry) > Date.now() + EXPIRY_MARGIN_MS) return accessToken
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const { clientId, clientSecret, redirectUri } = traktCredentials()
    const refreshToken = get(traktRefreshToken)
    if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
      clearTraktSession()
      throw new Error('Reconnect Trakt to refresh this session.')
    }
    const response = await traktOAuthFetch('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'refresh_token',
      }),
    })
    if (!response.ok) {
      clearTraktSession()
      throw await tokenError(response, 'Trakt token refresh failed')
    }
    const reply = await response.json() as TraktTokenReply
    saveTraktToken(reply)
    return reply.access_token
  })().finally(() => { refreshInFlight = null })
  return refreshInFlight
}

async function authorizedRequest(path: string, init: RequestInit, token: string): Promise<Response> {
  const { clientId } = traktCredentials()
  return trackerHttpFetch(`${API}${path}`, {
    ...init,
    headers: {
      ...JSON_HEADERS,
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> ?? {}),
    },
  }, 'Trakt')
}

/** Authenticated Trakt request with proactive refresh and one reactive 401 refresh. */
export async function traktFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const { clientId } = traktCredentials()
  if (!clientId || !get(traktToken)) return null
  let token = await refreshTraktToken(false)
  let response = await authorizedRequest(path, init, token)
  if (response.status === 401) {
    token = await refreshTraktToken(true)
    response = await authorizedRequest(path, init, token)
  }
  return response
}

export async function refreshTraktViewer(): Promise<void> {
  const response = await traktFetch('/users/settings?extended=images')
  if (!response?.ok) return
  const json = await response.json() as {
    user?: {
      username?: string
      name?: string | null
      ids?: { slug?: string }
      images?: { avatar?: { full?: string } }
    }
  }
  const user = json.user
  traktUserName.set(user?.name || user?.username || 'Trakt user')
  traktUserSlug.set(user?.ids?.slug ?? user?.username ?? '')
  traktUserAvatar.set(user?.images?.avatar?.full ?? '')
}

/** Test-only reset for the module-level refresh lock. */
export function resetTraktClientForTests() {
  refreshInFlight = null
}
