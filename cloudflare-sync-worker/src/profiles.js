/** @typedef {import('../../src/lib/profiles/store').IzumiProfile} Viewer */
/** @typedef {{ household?: { enabled?: boolean, profiles: Viewer[] }, catalog: { showAdult: boolean } }} ViewerConfig */
/** @typedef {import('../../src/lib/companion/protocol').CompanionMedia} Media */
/** @typedef {import('../../src/lib/companion/protocol').CompanionHomeSnapshot} Snapshot */

const ID = /^[A-Za-z0-9_-]{1,100}$/
/** @param {any} value */
export function normalizeHousehold(value) {
  if (!value || typeof value !== 'object') return undefined
  const profiles = (Array.isArray(value.profiles) ? value.profiles : []).slice(0, 8).flatMap((/** @type {any} */ item) => {
    if (!item || !ID.test(item.id) || typeof item.name !== 'string') return []
    const pin = item.pin && /^[0-9a-f]{32}$/i.test(item.pin.salt) && /^[0-9a-f]{64}$/i.test(item.pin.hash)
      ? { salt: item.pin.salt, hash: item.pin.hash } : undefined
    if (item.pin && !pin) throw new Error('Invalid household PIN record. Save profiles again in Izumi.')
    return [{ id: item.id, name: item.name.slice(0, 32), avatar: item.avatar, color: item.color,
      createdAt: Number(item.createdAt) || 0, updatedAt: Number(item.updatedAt) || 0,
      ratingLimit: [7, 12, 16, 18].includes(item.ratingLimit) ? item.ratingLimit : 18,
      allowAdult: item.ratingLimit === 18 && item.allowAdult === true, pin }]
  })
  return { enabled: value.enabled === true, modeUpdatedAt: Number(value.modeUpdatedAt) || 0, profiles }
}

/** @param {unknown} value */
export function validSnapshotSelector(value) {
  if (typeof value !== 'string') return false
  const parts = value.split('~')
  if (parts.length > 2 || parts.length === 2 && !ID.test(parts[0])) return false
  return ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'merged', 'jvm'].includes(parts[parts.length - 1])
}

/** PIN input is transient TLS request data, never persisted or echoed by the Worker.
 * @param {ViewerConfig} profile
 * @param {{ profileId?: unknown, profilePin?: unknown }} input
 */
export async function viewerForRequest(profile, input) {
  const household = profile.household
  if (!household?.enabled) return null
  const viewer = household.profiles.find((item) => item.id === input?.profileId)
  if (!viewer) throw new Error('Choose an available profile on your TV first.')
  if (viewer.pin) {
    if (typeof input?.profilePin !== 'string' || !/^\d{4,6}$/.test(input.profilePin)) throw new Error('Unlock this profile on your TV first.')
    const bytes = new TextEncoder().encode(`${viewer.pin.salt}:${input.profilePin}`)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
    let difference = 0
    for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ viewer.pin.hash.charCodeAt(index)
    if (difference) throw new Error('The profile PIN is incorrect.')
  }
  profile.catalog.showAdult = profile.catalog.showAdult && viewer.allowAdult && viewer.ratingLimit === 18
  return viewer
}

/** @param {{contentRating?: string, isAdult?: boolean} | null | undefined} media @param {Viewer | null | undefined} viewer */
export function viewerAllows(media, viewer) {
  if (!media || !viewer) return true
  if (media.isAdult && !viewer.allowAdult) return false
  const rating = String(media.contentRating ?? '')
  /** @type {Array<[RegExp, number]>} */
  const patterns = [[/\b(?:nc-?17|tv-ma|18\+?|r18|rx|adult)\b/i, 18], [/\b(?:r\+?|tv-?17|17\+?|16\+?|16)\b/i, 16], [/\b(?:pg-?13|tv-14|15|14\+?|12a?)\b/i, 12], [/\b(?:pg|tv-pg|tv-y7|7\+?)\b/i, 7]]
  const age = patterns.find(([pattern]) => pattern.test(rating))?.[1]
  return age === undefined || age <= viewer.ratingLimit
}

/** @param {Snapshot | null} snapshot @param {ViewerConfig} profile @param {Viewer | null} viewer */
export function scopeSnapshot(snapshot, profile, viewer) {
  if (!snapshot) return snapshot
  const rows = snapshot.rows.map((row) => ({ ...row, items: row.items.filter((item) => viewerAllows(item, viewer)) })).filter((row) => row.items.length)
  return { ...snapshot, profileId: viewer?.id ?? 'default', household: profile.household, rows,
    hero: viewerAllows(snapshot.hero, viewer) ? snapshot.hero : rows[0]?.items[0],
    history: snapshot.history?.filter((item) => viewerAllows(item, viewer)),
    views: snapshot.views ? Object.fromEntries(Object.entries(snapshot.views).map(([key, items]) => [key, items?.filter((item) => viewerAllows(item, viewer))])) : undefined }
}
