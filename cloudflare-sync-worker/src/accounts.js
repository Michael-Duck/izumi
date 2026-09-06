import { catalogInternals, decodeStremioRef } from './catalog.js'
import { normalizeAddonBase } from './resolver.js'

const NUVIO = 'https://api.nuvio.tv'
const PUBLIC_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN'
const STREMIO = 'https://api.strem.io/api'
const first = value => Array.isArray(value) ? value[0] : value
const array = value => { if (!Array.isArray(value)) throw new Error('Account service returned an invalid list. Try again.'); return value }
const text = (value, max = 512) => typeof value === 'string' ? value.slice(0, max) : ''
export const accountServices = ['nuvio', 'stremio']

/** Fixed service origins only. Never include upstream response bodies, credentials or URLs in errors. */
export async function serviceJson(url, data, token, fetcher = fetch) {
  const target = new URL(url)
  if (![NUVIO, 'https://api.strem.io'].includes(target.origin)) throw new Error('Invalid account service.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetcher(url, {
      method: data === undefined ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(target.origin === NUVIO ? { apikey: PUBLIC_KEY } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    if (!response.ok) {
      const error = new Error(response.status === 401 || response.status === 403 ? 'Reconnect this account in Izumi → Sync → TV accounts.' : `Account service returned HTTP ${response.status}. Try again shortly.`)
      error.status = response.status
      throw error
    }
    if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Account response is too large.')
    const reader = response.body?.getReader()
    let size = 0, source = ''
    const decoder = new TextDecoder()
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 8 * 1024 * 1024) throw new Error('Account response is too large.')
          source += decoder.decode(value, { stream: true })
        }
      } finally { await reader.cancel().catch(() => {}) }
      source += decoder.decode()
    }
    const result = source ? JSON.parse(source) : null
    if (result?.error) throw new Error('The account service rejected the request. Check the connection in Izumi.')
    if (target.origin === 'https://api.strem.io' && (!result || !Object.hasOwn(result, 'result'))) throw new Error('Stremio returned an invalid response.')
    return target.origin === 'https://api.strem.io' ? result.result : result
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The account service timed out. Try again.')
    if (error instanceof SyntaxError) throw new Error('The account service returned an invalid response.')
    throw error
  } finally { clearTimeout(timer) }
}

export function accountScope(profile, viewer) { return profile.household?.enabled ? viewer.id : 'default' }

/** D1 lease serializes rotating refresh tokens and item updates across Worker isolates. */
export async function withAccount(db, owner, profileId, service, operation) {
  const keys = [owner, profileId, service]
  await db.prepare('INSERT OR IGNORE INTO connected_accounts (owner_device_id, profile_id, service) VALUES (?, ?, ?)').bind(...keys).run()
  const now = Date.now(), lease = now + 120_000
  const lock = await db.prepare('UPDATE connected_accounts SET lease_until = ? WHERE owner_device_id = ? AND profile_id = ? AND service = ? AND lease_until < ?').bind(lease, ...keys, now).run()
  if (!Number(lock.meta?.changes)) throw new Error('Account sync is busy. Try again in a moment.')
  try {
    const row = await db.prepare('SELECT connection_json AS value FROM connected_accounts WHERE owner_device_id = ? AND profile_id = ? AND service = ?').bind(...keys).first()
    let account = JSON.parse(row?.value || '{}')
    const persist = async () => {
      if (new TextEncoder().encode(JSON.stringify(account)).length > 1_800_000) throw new Error('This account snapshot is too large for TV sync. Browse it in the full client.')
      const saved = await db.prepare('UPDATE connected_accounts SET connection_json = ?, revision = revision + 1 WHERE owner_device_id = ? AND profile_id = ? AND service = ? AND lease_until = ?').bind(JSON.stringify(account), ...keys, lease).run()
      if (!Number(saved.meta?.changes)) throw new Error('Account connection changed. Try again.')
    }
    return await operation(account, persist, value => { account = value })
  } finally {
    await db.prepare('UPDATE connected_accounts SET lease_until = 0 WHERE owner_device_id = ? AND profile_id = ? AND service = ? AND lease_until = ?').bind(...keys, lease).run()
  }
}

function acceptSession(account, raw) {
  if (!raw?.access_token || !raw?.refresh_token || !Number.isFinite(Number(raw.expires_in ?? 3600))) throw new Error('Nuvio did not return a usable session.')
  account.session = { accessToken: raw.access_token, refreshToken: raw.refresh_token, expiresAt: Date.now() + Number(raw.expires_in ?? 3600) * 1000 }
  account.email = text(raw.user?.email, 254) || account.email || ''
}

export function nuvioApi(account, persist, fetcher = fetch) {
  const refresh = async () => {
    const raw = await serviceJson(`${NUVIO}/auth/v1/token?grant_type=refresh_token`, { refresh_token: account.session.refreshToken }, undefined, fetcher)
    acceptSession(account, raw)
    await persist()
  }
  return async (path, data) => {
    if (!account.session) throw new Error('Connect Nuvio in Izumi → Sync → TV accounts.')
    if (account.session.expiresAt < Date.now() + 60_000) {
      await refresh()
    }
    try { return await serviceJson(`${NUVIO}${path}`, data, account.session.accessToken, fetcher) }
    catch (error) {
      if (error.status !== 401) throw error
      await refresh()
      return serviceJson(`${NUVIO}${path}`, data, account.session.accessToken, fetcher)
    }
  }
}
const rpc = (api, name, body = {}) => api(`/rest/v1/rpc/${name}`, body)
const stremioApi = (account, name, data, fetcher) => serviceJson(`${STREMIO}/${name}`, { ...data, authKey: account.authKey }, undefined, fetcher)

export function publicAccount(account, service) {
  return { service, connected: !!(service === 'nuvio' ? account.session : account.authKey), email: account.email || '',
    profile: account.profile ?? null, sources: account.sources === true, playback: account.playback === true,
    updatedAt: account.cache?.at ?? null }
}

export async function readAccounts(db, owner, profileId) {
  const rows = await db.prepare('SELECT service, connection_json AS value FROM connected_accounts WHERE owner_device_id = ? AND profile_id = ?').bind(owner, profileId).all()
  return accountServices.map(service => publicAccount(JSON.parse(rows.results?.find(row => row.service === service)?.value || '{}'), service))
}

export async function manageAccount(account, persist, replace, service, input, fetcher = fetch) {
  if (input.action === 'disconnect') {
    // Revoke only the Worker's dedicated Nuvio session. Stremio's imported token is shared.
    if (service === 'nuvio' && account.session) await serviceJson(`${NUVIO}/auth/v1/logout?scope=local`, {}, account.session.accessToken, fetcher).catch(() => {})
    replace({}); await persist(); return { connected: false }
  }
  if (service === 'nuvio' && input.action === 'link') {
    if (account.session) throw new Error('Disconnect the existing TV account before linking another.')
    const nonce = crypto.randomUUID()
    const result = first(await serviceJson(`${NUVIO}/rest/v1/rpc/start_device_login_session`, {
      p_device_nonce: nonce, p_redirect_base_url: 'https://nuvio.tv/link', p_device_name: 'Izumi TV sync', p_device_type: 'mobile',
    }, undefined, fetcher))
    const url = new URL(result?.verification_uri_complete)
    const code = text(result?.user_code).replace(/[^a-z0-9]/gi, '').toUpperCase()
    if (url.origin !== 'https://nuvio.tv' || url.pathname !== '/link' || url.username || url.password || code.length !== 6 || !result.device_code) throw new Error('Nuvio returned an invalid sign-in link.')
    account.pending = { nonce, code: result.device_code, expiresAt: Date.now() + 10 * 60_000, nextPoll: 0 }
    await persist()
    return { code, url: url.href, interval: Math.max(3, Math.min(10, Number(result.poll_interval_seconds) || 3)) }
  }
  if (service === 'nuvio' && input.action === 'poll') {
    const pending = account.pending
    if (!pending || pending.expiresAt < Date.now()) throw new Error('This sign-in code expired. Get a new code.')
    if (pending.nextPoll > Date.now()) return { pending: true }
    pending.nextPoll = Date.now() + 3000
    await persist()
    const result = first(await serviceJson(`${NUVIO}/rest/v1/rpc/poll_tv_login_session`, { p_code: pending.code, p_device_nonce: pending.nonce }, undefined, fetcher))
    if (result?.status === 'pending') return { pending: true }
    if (result?.status !== 'approved') throw new Error('This sign-in code expired. Get a new code.')
    acceptSession(account, await serviceJson(`${NUVIO}/functions/v1/tv-logins-exchange`, { code: pending.code, device_nonce: pending.nonce }, undefined, fetcher))
    delete account.pending
    await persist()
    return publicAccount(account, service)
  }
  if (service === 'stremio' && input.action === 'connect') {
    if (typeof input.authKey !== 'string' || !input.authKey || input.authKey.length > 4096) throw new Error('Connect Stremio in Izumi first.')
    const candidate = { authKey: input.authKey }
    const user = await stremioApi(candidate, 'getUser', { type: 'GetUser' }, fetcher)
    if (!user?._id) throw new Error('Stremio could not verify this account.')
    Object.assign(account, candidate, { email: text(user.email, 254), profile: 1, sources: false, playback: false })
    delete account.cache
    delete account.sourcesCache
    delete account.collectionsCache
    await persist()
    return publicAccount(account, service)
  }
  if (service === 'nuvio' && input.action === 'profiles') {
    const profiles = array(await rpc(nuvioApi(account, persist, fetcher), 'sync_pull_profiles'))
    return { profiles: profiles.map(value => ({ id: value.profile_index, name: text(value.name, 100), locked: value.pin_enabled === true })) }
  }
  if (input.action === 'configure') {
    if (service === 'nuvio') {
      const profiles = array(await rpc(nuvioApi(account, persist, fetcher), 'sync_pull_profiles'))
      const selected = profiles.find(value => value.profile_index === Number(input.profile))
      if (!selected || selected.pin_enabled) throw new Error('Choose an unlocked Nuvio profile. Nuvio’s public API does not support PIN unlock.')
      account.profile = selected.profile_index
    } else if (!account.authKey) throw new Error('Connect Stremio first.')
    account.sources = input.sources === true
    account.playback = input.playback === true
    delete account.cache
    delete account.sourcesCache
    delete account.collectionsCache
    await persist()
    return publicAccount(account, service)
  }
  throw new Error('Unsupported account action.')
}

async function pages(load, size) {
  const result = []
  for (let page = 0; page < 10; page++) {
    const items = array(await load(page))
    result.push(...items)
    if (items.length < size) return result
  }
  throw new Error('This account exceeds the TV sync limit. Open the full client to browse it.')
}

export async function pullAccount(account, persist, service, fetcher = fetch) {
  if (!account.profile) return null
  let data
  if (service === 'nuvio') {
    const api = nuvioApi(account, persist, fetcher), profile = account.profile
    const profiles = array(await rpc(api, 'sync_pull_profiles'))
    const selected = profiles.find(item => item.profile_index === profile)
    if (!selected || selected.pin_enabled) throw new Error('This Nuvio profile is locked or no longer available. Choose another in TV accounts.')
    if (account.cache?.at > Date.now() - 60_000) return account.cache
    const addonsProfile = selected.uses_primary_addons ? 1 : profile
    // Capture cursors before the full snapshot, then replay concurrent changes without losing deletes.
    const snapshotWithDelta = async (kind, load, key) => {
      const start = first(await rpc(api, `sync_get_${kind}_delta_cursor`, { p_profile_id: profile }))
      let cursor = Number(typeof start === 'object' ? start?.event_id ?? start?.cursor ?? start?.last_event_id ?? 0 : start)
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Nuvio returned an invalid sync cursor.')
      const items = new Map((await load()).map(item => [key(item), item]))
      for (let page = 0; page < 10; page++) {
        const changes = array(await rpc(api, `sync_pull_${kind}_delta`, { p_profile_id: profile, p_since_event_id: cursor, p_limit: 500 }))
        const previousCursor = cursor
        for (const event of changes) {
          if (!Number.isSafeInteger(Number(event.event_id)) || Number(event.event_id) <= previousCursor || !['delete', 'upsert'].includes(event.operation)) throw new Error('Nuvio returned an invalid sync event.')
          const item = event.item ?? event
          if (event.operation === 'delete') items.delete(key(item)); else items.set(key(item), item)
          cursor = Math.max(cursor, Number(event.event_id) || 0)
        }
        if (changes.length < 500) return [...items.values()]
      }
      throw new Error('Account changed too quickly. Refresh again shortly.')
    }
    const library = await snapshotWithDelta('library', () => pages(page => rpc(api, 'sync_pull_library', { p_profile_id: profile, p_limit: 500, p_offset: page * 500 }), 500), item => `${item.content_type}:${item.content_id}`)
    const progress = await snapshotWithDelta('watch_progress', () => rpc(api, 'sync_pull_watch_progress', { p_profile_id: profile, p_limit: 200 }), item => item.progress_key || `${item.content_id}_s${item.season}e${item.episode}`)
    const collections = first(await rpc(api, 'sync_pull_collections', { p_profile_id: profile }))?.collections_json ?? []
    const history = array(await rpc(api, 'sync_pull_watched_items', { p_profile_id: profile, p_page: 1, p_page_size: 500 }))
    const addons = account.sources ? array(await api(`/rest/v1/addons?select=url,enabled&profile_id=eq.${addonsProfile}&order=sort_order`)).filter(item => item.enabled !== false).map(item => item.url) : []
    data = { library, progress, history, collections, addons }
  } else {
    if (account.cache?.at > Date.now() - 60_000) return account.cache
    const library = array(await stremioApi(account, 'datastoreGet', { collection: 'libraryItem', ids: [], all: true }, fetcher))
    const addons = account.sources ? array((await stremioApi(account, 'addonCollectionGet', { type: 'AddonCollectionGet', update: true }, fetcher))?.addons).filter(item => !item.flags?.disabled).map(item => item.transportUrl) : []
    data = { library, addons, collections: [], progress: [], history: [] }
  }
  data.addons = [...new Set(data.addons.flatMap(value => { try { return [normalizeAddonBase(value)] } catch { return [] } }))].slice(0, 8)
  account.cache = { ...data, at: Date.now() }
  await persist()
  return account.cache
}

export function accountMedia(raw, service, base) {
  const id = service === 'nuvio' ? raw.content_id : raw._id
  const type = service === 'nuvio' ? raw.content_type : raw.type
  if (!['movie', 'series'].includes(type) || !id) return null
  const media = catalogInternals.stremioMedia({ ...raw, id, type, name: raw.name || raw.title || id, poster: raw.poster,
    background: raw.background, releaseInfo: raw.release_info, imdbRating: raw.imdb_rating }, base, type)
  if (!media) return null
  const video = service === 'nuvio' ? raw.video_id : raw.state?.video_id
  const coords = type === 'series' ? /^.+:(\d+):(\d+)$/.exec(video || '') : null
  const season = Number(raw.season ?? coords?.[1]), episode = Number(raw.episode ?? coords?.[2])
  const position = Number(service === 'nuvio' ? raw.position : raw.state?.timeOffset) / 1000
  const duration = Number(service === 'nuvio' ? raw.duration : raw.state?.duration) / 1000
  if (type === 'movie' || Number.isInteger(season) && season >= 0 && Number.isInteger(episode) && episode > 0) {
    if (type === 'series') Object.assign(media, { season, episode })
    if (video) media.resolver.videoId = text(video)
    if (position > 0 && (!duration || position < duration * .9)) media.resumePositionSeconds = position
  }
  return media
}

export async function pullAccountCollections(account, persist, fetcher = fetch) {
  if (!account.profile) return []
  const api = nuvioApi(account, persist, fetcher)
  const profiles = array(await rpc(api, 'sync_pull_profiles'))
  if (!profiles.some(value => value.profile_index === account.profile && !value.pin_enabled)) throw new Error('Nuvio profile unavailable or locked.')
  if (account.collectionsCache?.at > Date.now() - 60_000) return account.collectionsCache.value
  const value = first(await rpc(api, 'sync_pull_collections', { p_profile_id: account.profile }))?.collections_json ?? []
  if (!Array.isArray(value)) throw new Error('Nuvio returned an invalid collection document.')
  account.collectionsCache = { at: Date.now(), value }
  await persist()
  return value
}

export async function accountSources(account, persist, service, fetcher = fetch) {
  if (!account.profile || !account.sources) return []
  let urls
  if (service === 'nuvio') {
    const api = nuvioApi(account, persist, fetcher)
    const profiles = array(await rpc(api, 'sync_pull_profiles'))
    const selected = profiles.find(value => value.profile_index === account.profile && !value.pin_enabled)
    if (!selected) throw new Error('Nuvio profile unavailable or locked.')
    if (account.sourcesCache?.at > Date.now() - 60_000) return account.sourcesCache.urls
    urls = array(await api(`/rest/v1/addons?select=url,enabled&profile_id=eq.${selected.uses_primary_addons ? 1 : account.profile}&order=sort_order`)).filter(value => value.enabled !== false).map(value => value.url)
  } else {
    if (account.sourcesCache?.at > Date.now() - 60_000) return account.sourcesCache.urls
    urls = array((await stremioApi(account, 'addonCollectionGet', { type: 'AddonCollectionGet', update: true }, fetcher))?.addons).filter(value => !value.flags?.disabled).map(value => value.transportUrl)
  }
  urls = [...new Set(urls.flatMap(value => { try { return [normalizeAddonBase(value)] } catch { return [] } }))].slice(0, 8)
  account.sourcesCache = { at: Date.now(), urls }
  await persist()
  return urls
}

export function progressEntry(input) {
  const media = input?.media
  if (!media?.ref || !Number.isFinite(input.positionSeconds) || !Number.isFinite(input.durationSeconds)
    || input.positionSeconds < 0 || input.durationSeconds <= 0 || input.durationSeconds > 604800
    || !Number.isFinite(input.updatedAt) || input.updatedAt > Date.now() + 60_000 || input.updatedAt < Date.now() - 86400_000) throw new Error('Invalid account playback progress.')
  const native = media.ref.provider === 'stremio' ? decodeStremioRef(media.ref.id) : null
  const type = media.resolver?.nativeType || native?.type || media.ref.type
  const id = native?.id || media.resolver?.imdbId || (media.resolver?.tmdbId ? `tmdb:${media.resolver.tmdbId}` : media.ref.provider === 'tmdb' ? `tmdb:${media.ref.id}` : '')
  if (!id || !['movie', 'series'].includes(type)) return null
  if (type === 'series' && (!Number.isInteger(media.season) || media.season < 0 || !Number.isInteger(media.episode) || media.episode < 1)) return null
  return { content_id: text(id), content_type: type, name: text(media.title, 240), poster: text(media.poster, 2048),
    video_id: text(media.resolver?.videoId || (type === 'movie' ? id : `${id}:${media.season}:${media.episode}`)),
    ...(type === 'series' ? { season: media.season, episode: media.episode } : {}),
    position: Math.round(Math.min(input.positionSeconds, input.durationSeconds) * 1000), duration: Math.round(input.durationSeconds * 1000), last_watched: Math.round(input.updatedAt) }
}

export async function pushAccountProgress(account, persist, service, input, fetcher = fetch) {
  if (!account.playback || !account.profile) return { skipped: true }
  const item = progressEntry(input)
  if (!item) return { skipped: true }
  if (service === 'nuvio') {
    const api = nuvioApi(account, persist, fetcher)
    const profiles = array(await rpc(api, 'sync_pull_profiles'))
    if (!profiles.some(value => value.profile_index === account.profile && !value.pin_enabled)) throw new Error('Nuvio profile unavailable or locked.')
    const current = array(await rpc(api, 'sync_pull_watch_progress', { p_profile_id: account.profile, p_limit: 200 }))
      .find(value => value.content_id === item.content_id && (value.season ?? null) === (item.season ?? null) && (value.episode ?? null) === (item.episode ?? null))
    if (Number(current?.last_watched) >= item.last_watched) return { skipped: true }
    await rpc(api, 'sync_push_watch_progress', { p_profile_id: account.profile, p_entries: [item] })
  } else {
    const current = array(await stremioApi(account, 'datastoreGet', { collection: 'libraryItem', ids: [item.content_id], all: false }, fetcher))[0]
    if (Date.parse(current?._mtime) >= item.last_watched) return { skipped: true }
    const at = new Date(item.last_watched).toISOString()
    const state = { timeWatched: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, noNotif: false, ...current?.state,
      timeOffset: item.position >= item.duration * .9 ? 0 : item.position, duration: item.duration, video_id: item.video_id, lastWatched: at }
    const change = { _id: item.content_id, name: item.name, type: item.content_type, poster: item.poster || null, posterShape: 'poster',
      removed: true, temp: true, _ctime: at, ...current, _mtime: at, state }
    await stremioApi(account, 'datastorePut', { collection: 'libraryItem', changes: [change] }, fetcher)
  }
  delete account.cache
  await persist()
  return { synced: true }
}
