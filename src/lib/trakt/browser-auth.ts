import { openUrl } from '@tauri-apps/plugin-opener'
import { get, writable } from 'svelte/store'
import { activeProfileId, profileStorageKey } from '$lib/profiles/store'
import { traktRedirectUri } from './config'
import { refreshTraktViewer, saveTraktToken, traktCredentials, traktOAuthFetch } from './client'
import { createTraktAuthorization, parseTraktCallback, TRAKT_AUTH_TTL_MS, validTraktAuthorization, type TraktAuthorization } from './oauth'
import type { TraktTokenReply } from './types'

const owner = get(activeProfileId)
const storageKey = profileStorageKey('trakt-browser-auth-v1', owner)
function readPending(): TraktAuthorization | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (validTraktAuthorization(raw, owner, traktCredentials().clientId)) return raw
    localStorage.removeItem(storageKey)
    return null
  } catch { return null }
}
const restoredPending = readPending()
export const traktBrowserAuth = writable<{ phase: 'idle' | 'waiting' | 'exchanging' | 'connected' | 'error'; message?: string }>({ phase: restoredPending ? 'waiting' : 'idle' })
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let exchange: { state: string; promise: Promise<void>; controller: AbortController } | null = null
let generation = 0
let starting = false

function removePending() { localStorage.removeItem(storageKey); clearTimeout(expiryTimer) }
function expireAt(createdAt: number) {
  clearTimeout(expiryTimer)
  expiryTimer = setTimeout(() => {
    removePending()
    traktBrowserAuth.set({ phase: 'error', message: 'Trakt sign-in expired. Choose Connect to try again.' })
  }, Math.max(0, createdAt + TRAKT_AUTH_TTL_MS - Date.now()))
}
if (restoredPending) expireAt(restoredPending.createdAt)

export function cancelTraktBrowserAuth(): void {
  generation++
  exchange?.controller.abort()
  removePending()
  traktBrowserAuth.set({ phase: 'idle' })
}
export async function startTraktBrowserAuth(): Promise<void> {
  if (owner !== get(activeProfileId)) throw new Error('Reopen Trakt settings in your current profile.')
  if (exchange || starting || readPending()) throw new Error('Finish or cancel the current connection first.')
  const { clientId, clientSecret } = traktCredentials()
  if (!clientId || !clientSecret) throw new Error('Enter the Client ID and Client secret from your Trakt app first.')
  const attempt = ++generation
  starting = true
  try {
    const { pending, url } = await createTraktAuthorization(clientId, owner)
    if (attempt !== generation || owner !== get(activeProfileId)) throw new DOMException('Connection cancelled', 'AbortError')
    // Persist only the one-time transaction so returning after an app restart still works.
    localStorage.setItem(storageKey, JSON.stringify(pending))
    traktBrowserAuth.set({ phase: 'waiting' })
    expireAt(pending.createdAt)
    await openUrl(url)
  } catch (reason) {
    if (attempt === generation) {
      removePending()
      traktBrowserAuth.set({ phase: 'error', message: 'Could not start browser sign-in. Try again.' })
    }
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
    throw new Error('Could not start browser sign-in. Try again.')
  } finally { starting = false }
}
export async function completeTraktBrowserAuth(raw: string): Promise<void> {
  const callback = parseTraktCallback(raw)
  if (!callback) throw new Error('This Trakt return link is invalid.')
  if (owner !== get(activeProfileId)) throw new Error('Return to the Izumi profile that started Trakt sign-in.')
  if (exchange?.state === callback.state) return exchange.promise
  const pending = readPending()
  if (!pending || callback.state !== pending.state) throw new Error('This Trakt link expired or belongs to another sign-in. Start again from this profile.')
  // Consume before the network request: cancelled, repeated and replayed callbacks cannot exchange again.
  removePending()
  if (callback.error) {
    const message = callback.error === 'access_denied' ? 'Trakt connection cancelled.' : 'Trakt could not authorize this connection. Try again.'
    traktBrowserAuth.set({ phase: 'error', message })
    throw new Error(message)
  }
  const controller = new AbortController()
  traktBrowserAuth.set({ phase: 'exchanging' })
  const promise = (async () => {
    try {
      const response = await traktOAuthFetch('/oauth/token', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ client_id: pending.clientId, client_secret: traktCredentials().clientSecret, redirect_uri: pending.redirectUri, code: callback.code, code_verifier: pending.verifier, grant_type: 'authorization_code' }),
      })
      if (!response.ok) throw new Error('Trakt could not complete sign-in. Check the registered callback and start again.')
      const reply = await response.json().catch(() => null) as TraktTokenReply | null
      if (typeof reply?.access_token !== 'string' || !reply.access_token || typeof reply.refresh_token !== 'string' || !reply.refresh_token
        || !Number.isFinite(reply.expires_in) || reply.expires_in <= 0
        || (reply.created_at != null && (!Number.isFinite(reply.created_at) || reply.created_at < 0))) throw new Error('Trakt returned an incomplete session. Start again.')
      if (controller.signal.aborted || owner !== get(activeProfileId)) throw new DOMException('Connection cancelled', 'AbortError')
      traktRedirectUri.set(pending.redirectUri)
      saveTraktToken(reply)
      // A temporary metadata failure must not discard successfully connected credentials.
      await refreshTraktViewer().catch(() => {})
      if (!controller.signal.aborted) traktBrowserAuth.set({ phase: 'connected' })
      void import('./sync').then(({ flushTraktSyncQueue }) => flushTraktSyncQueue()).catch(() => {})
    } catch (reason) {
      if (!controller.signal.aborted) traktBrowserAuth.set({ phase: 'error', message: reason instanceof Error ? reason.message : 'Trakt connection failed.' })
      throw reason
    } finally { exchange = null }
  })()
  exchange = { state: callback.state, promise, controller }
  return promise
}
