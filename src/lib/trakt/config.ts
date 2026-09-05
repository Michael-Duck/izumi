import { profiledPersisted } from '$lib/profiles/store'
import type { TraktQueuedAction } from './types'
import { TRAKT_SITE_REDIRECT_URI } from './oauth'
export { TRAKT_SITE_REDIRECT_URI } from './oauth'

/** The registered Trakt application credentials are supplied by the user on this device.
 * These credentials stay in the active Izumi profile's local storage and are never synced. */
export const traktClientId = profiledPersisted('trakt-client-id', '')
export const traktClientSecret = profiledPersisted('trakt-client-secret', '')
export const TRAKT_DEVICE_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'
// Existing device-code sessions retain their original value until the next browser connection.
export const traktRedirectUri = profiledPersisted('trakt-redirect-uri', TRAKT_SITE_REDIRECT_URI)

export const traktToken = profiledPersisted<string | null>('trakt-token', null)
export const traktRefreshToken = profiledPersisted<string | null>('trakt-refresh-token', null)
export const traktTokenExpiry = profiledPersisted('trakt-token-expiry', 0)
export const traktUserName = profiledPersisted('trakt-viewer-name', '')
export const traktUserSlug = profiledPersisted('trakt-viewer-slug', '')
export const traktUserAvatar = profiledPersisted('trakt-viewer-avatar', '')

export const traktSyncQueue = profiledPersisted<TraktQueuedAction[]>('trakt-sync-queue', [])
export const traktHistoryDedupe = profiledPersisted<Record<string, number>>('trakt-history-dedupe', {})
