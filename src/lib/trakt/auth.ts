import { openUrl } from '@tauri-apps/plugin-opener'
import { get } from 'svelte/store'
import {
  clearTraktSession,
  refreshTraktViewer,
  saveTraktToken,
  traktCredentials,
  traktOAuthFetch,
} from './client'
import { traktToken } from './config'
import type { TraktDeviceCode, TraktTokenReply } from './types'

function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('The request was aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      reject(new DOMException('The request was aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function authFailure(status: number): string {
  if (status === 404) return 'Trakt no longer recognizes this device code. Start again.'
  if (status === 409) return 'This Trakt code was already used. Start again.'
  if (status === 410) return 'The Trakt code expired. Start again.'
  if (status === 418) return 'Trakt sign-in was declined.'
  if (status === 429) return 'Trakt asked Izumi to slow down. Try again shortly.'
  if (status >= 500) return 'Trakt is temporarily unavailable. Try again shortly.'
  return `Trakt sign-in failed (${status}).`
}

function safeVerificationUrl(value?: string): string {
  try {
    const url = new URL(value || 'https://auth.trakt.tv/activate')
    return url.protocol === 'https:' && url.hostname === 'auth.trakt.tv'
      ? url.toString()
      : 'https://auth.trakt.tv/activate'
  } catch { return 'https://auth.trakt.tv/activate' }
}

export async function connectTrakt(
  onCode?: (code: TraktDeviceCode) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { clientId, clientSecret, redirectUri } = traktCredentials()
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Enter the Client ID, Client secret, and Redirect URI from your Trakt app first.')
  }

  const start = await traktOAuthFetch('/oauth/device/code', {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId }),
    signal,
  })
  const raw = await start.json().catch(() => ({})) as {
    device_code?: string
    user_code?: string
    verification_url?: string
    expires_in?: number
    interval?: number
  }
  if (!start.ok || !raw.device_code || !raw.user_code) throw new Error(authFailure(start.status))
  const code: TraktDeviceCode = {
    deviceCode: raw.device_code,
    userCode: raw.user_code,
    verificationUrl: safeVerificationUrl(raw.verification_url),
    expiresIn: raw.expires_in ?? 600,
    interval: Math.max(1, raw.interval ?? 5),
  }
  onCode?.(code)
  await openUrl(code.verificationUrl)

  const deadline = Date.now() + code.expiresIn * 1_000
  let intervalMs = code.interval * 1_000
  while (Date.now() < deadline) {
    await waitFor(intervalMs, signal)
    const poll = await traktOAuthFetch('/oauth/device/token', {
      method: 'POST',
      body: JSON.stringify({ code: code.deviceCode, client_id: clientId, client_secret: clientSecret }),
      signal,
    })
    if (poll.ok) {
      saveTraktToken(await poll.json() as TraktTokenReply)
      await refreshTraktViewer()
      void import('./sync').then(({ flushTraktSyncQueue }) => flushTraktSyncQueue()).catch(() => {})
      return
    }
    if (poll.status === 400) continue
    if (poll.status === 429) {
      intervalMs += 5_000
      continue
    }
    throw new Error(authFailure(poll.status))
  }
  throw new Error('The Trakt code expired. Start again.')
}

export async function disconnectTrakt(): Promise<void> {
  const token = get(traktToken)
  const { clientId, clientSecret } = traktCredentials()
  try {
    if (token && clientId && clientSecret) {
      await traktOAuthFetch('/oauth/revoke', {
        method: 'POST',
        body: JSON.stringify({ token, client_id: clientId, client_secret: clientSecret }),
      })
    }
  } catch {
    // Local sign-out must still succeed when Trakt is offline.
  } finally {
    clearTraktSession()
  }
}
