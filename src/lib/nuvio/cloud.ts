import { nuvioClient, object, first, string } from './auth'
import { collectionImageUrl } from '$lib/catalog/collections/model'

export type JsonRecord = Record<string, unknown>
export interface CloudProfile extends JsonRecord { profile_index: number; name: string; avatar_color_hex?: string; avatar_id?: string | null; avatar_url?: string | null; uses_primary_addons?: boolean; pin_enabled?: boolean }
export interface CloudAddon extends JsonRecord { url: string; name?: string; enabled?: boolean; sort_order?: number }
export interface CloudItem extends JsonRecord {
  content_id: string; content_type: 'movie' | 'series'; name?: string; title?: string; poster?: string | null;
  season?: number | null; episode?: number | null; position?: number; duration?: number; last_watched?: number; watched_at?: number; added_at?: number;
}
export interface DeltaEvent extends CloudItem { event_id: number; operation: 'upsert' | 'delete' }
export type Resource = 'library' | 'progress' | 'history'
export interface ResourceState { cursor: number; items: CloudItem[] }
export interface CloudBlob { value: JsonRecord | JsonRecord[]; updatedAt?: string }
export type BlobKind = 'collections' | 'settings' | 'home'
const endpoints = { library: 'library', progress: 'watch_progress', history: 'watched_items' } as const
const blobEndpoints = { collections: 'collections', settings: 'profile_settings_blob', home: 'home_catalog_settings' } as const
export const cloudIdentity = (kind: Resource, row: Pick<CloudItem, 'content_id' | 'content_type' | 'season' | 'episode'>): string =>
  JSON.stringify(kind === 'library' ? [row.content_type, row.content_id] : [row.content_type, row.content_id, row.season ?? null, row.episode ?? null])
export const nuvioProgressKey = (row: Pick<CloudItem, 'content_id' | 'season' | 'episode'>) => row.season != null && row.episode != null ? `${row.content_id}_s${row.season}e${row.episode}` : row.content_id
function profileId(value: number) { if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error('Choose a Nuvio profile from 1 to 6.'); return value }
function rows(value: unknown): JsonRecord[] { if (!Array.isArray(value)) throw new Error('Nuvio returned an invalid list.'); return value.map(object) }
function check(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError') }
function items(value: unknown): CloudItem[] {
  return rows(value).map((row) => {
    if (!string(row.content_id) || !['movie', 'series'].includes(string(row.content_type))) throw new Error('Nuvio returned an invalid media identity.')
    return row as CloudItem
  })
}
function cursor(value: unknown): number {
  const result = Number(first(value))
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Nuvio returned an invalid sync cursor.')
  return result
}
export function applyCloudDelta(kind: Resource, state: ResourceState, events: DeltaEvent[]): ResourceState {
  const result = new Map(state.items.map((row) => [cloudIdentity(kind, row), row]))
  let high = state.cursor
  for (const row of [...events].sort((a, b) => a.event_id - b.event_id)) {
    const id = cursor(row.event_id)
    if (id <= state.cursor) continue
    if (row.operation !== 'delete' && row.operation !== 'upsert') throw new Error('Nuvio returned an unknown sync operation.')
    if (row.operation === 'delete') result.delete(cloudIdentity(kind, row))
    else result.set(cloudIdentity(kind, row), row)
    high = Math.max(high, id)
  }
  return { items: [...result.values()], cursor: high }
}
export function sameCloudValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [key, canonical(row)])) : value
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/** Supported Nuvio Cloud API v1.3. Replacement writes always reread the complete remote document. */
export function createNuvioCloud(client = nuvioClient) {
  const rpc = (name: string, body: JsonRecord = {}, signal?: AbortSignal) => client.request('backend', `/rest/v1/rpc/${name}`, body, signal)
  const scoped = (id: number, params: JsonRecord = {}) => ({ ...params, p_profile_id: profileId(id) })
  const queues = new Map<string, Promise<unknown>>()
  async function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
    const old = queues.get(key)
    const next = (old ? old.catch(() => {}) : Promise.resolve()).then(action)
    queues.set(key, next)
    try { return await next } finally { if (queues.get(key) === next) queues.delete(key) }
  }
  async function profiles(signal?: AbortSignal): Promise<CloudProfile[]> {
    return rows(await rpc('sync_pull_profiles', {}, signal)).map((row) => ({ ...row, profile_index: profileId(Number(row.profile_index)), name: string(row.name) || `Profile ${row.profile_index}` }))
  }
  async function saveProfile(patch: CloudProfile, expected: CloudProfile | null, signal?: AbortSignal) {
    return serialized('profiles', async () => {
      const all = await profiles(signal), previous = all.find((row) => row.profile_index === profileId(patch.profile_index))
      if (!sameCloudValue(previous ?? null, expected)) throw new Error('This Nuvio profile changed elsewhere. Refresh before saving.')
      const updated = { ...previous, ...patch, profile_index: profileId(patch.profile_index), name: patch.name.trim().slice(0, 64) }
      if (!updated.name) throw new Error('Enter a profile name.')
      const complete = previous ? all.map((row) => row.profile_index === updated.profile_index ? updated : row) : [...all, updated]
      check(signal)
      await rpc('sync_push_profiles', { p_client_max_profiles: 6, p_profiles: complete.map(({ profile_index, name, avatar_color_hex, uses_primary_addons, avatar_id, avatar_url }) => ({ profile_index, name, avatar_color_hex, uses_primary_addons, avatar_id, avatar_url })) }, signal)
    })
  }
  async function deleteProfile(expected: CloudProfile, signal?: AbortSignal) {
    return serialized('profiles', async () => {
      const latest = (await profiles(signal)).find((row) => row.profile_index === expected.profile_index)
      if (!sameCloudValue(latest, expected)) throw new Error('This Nuvio profile changed elsewhere. Refresh before deleting it.')
      await rpc('sync_delete_profile_data', scoped(expected.profile_index), signal)
    })
  }
  async function addons(id: number, signal?: AbortSignal): Promise<CloudAddon[]> {
    return rows(await client.request('backend', `/rest/v1/addons?${new URLSearchParams({ select: '*', profile_id: `eq.${profileId(id)}`, order: 'sort_order' })}`, undefined, signal)).map((row) => {
      const url = collectionImageUrl(row.url)
      if (!url) throw new Error('A Nuvio source has an invalid URL.')
      return { ...row, url }
    })
  }
  async function saveAddons(id: number, values: CloudAddon[], expected: CloudAddon[], signal?: AbortSignal) {
    return serialized(`addons:${id}`, async () => {
      if (!sameCloudValue(await addons(id, signal), expected)) throw new Error('Nuvio sources changed elsewhere. Refresh before saving.')
      if (values.some((row) => !collectionImageUrl(row.url))) throw new Error('Every source needs an HTTP(S) manifest URL.')
      await rpc('sync_push_addons', scoped(id, { p_addons: values.map(({ url, name, enabled }, sort_order) => ({ url, name, enabled: enabled !== false, sort_order })) }), signal)
    })
  }
  async function blob(kind: BlobKind, id: number, platform = 'izumi', signal?: AbortSignal): Promise<CloudBlob> {
    const row = object(first(await rpc(`sync_pull_${blobEndpoints[kind]}`, scoped(id, kind === 'collections' ? {} : { p_platform: platform }), signal)))
    const value = kind === 'collections' ? row.collections_json ?? [] : row.settings_json ?? {}
    if (kind === 'collections' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nuvio returned an invalid settings document.')
    return { value: value as CloudBlob['value'], updatedAt: string(row.updated_at) || undefined }
  }
  async function saveBlob(kind: BlobKind, id: number, value: CloudBlob['value'], expected: CloudBlob, platform = 'izumi', signal?: AbortSignal) {
    return serialized(`${kind}:${id}:${platform}`, async () => {
      if (kind === 'collections' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a collection array or a settings object.')
      const latest = await blob(kind, id, platform, signal)
      if (!sameCloudValue(latest, expected)) throw new Error('This Nuvio document changed elsewhere. Refresh and review your changes again.')
      if (new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024) throw new Error('This document is larger than 8 MB.')
      await rpc(`sync_push_${blobEndpoints[kind]}`, scoped(id, kind === 'collections' ? { p_collections_json: value } : { p_platform: platform, p_settings_json: value }), signal)
    })
  }
  async function snapshot(kind: Resource, id: number, signal?: AbortSignal): Promise<CloudItem[]> {
    if (kind === 'progress') return items(await rpc('sync_pull_watch_progress', scoped(id, { p_limit: 200 }), signal))
    const result: CloudItem[] = []
    for (let page = 0; page < 2000; page++) {
      check(signal)
      const next = items(await rpc(`sync_pull_${endpoints[kind]}`, scoped(id, kind === 'library' ? { p_offset: page * 500, p_limit: 500 } : { p_page: page + 1, p_page_size: 500 }), signal))
      result.push(...next)
      if (next.length < 500) return result
    }
    throw new Error('This Nuvio library is too large to load in one sync.')
  }
  async function refresh(kind: Resource, id: number, previous?: ResourceState, signal?: AbortSignal): Promise<ResourceState> {
    // The Concepts section specifies cursor-before-snapshot to avoid losing concurrent changes.
    let state = previous
    if (!state) {
      const start = cursor(await rpc(`sync_get_${endpoints[kind]}_delta_cursor`, scoped(id), signal))
      state = { cursor: start, items: await snapshot(kind, id, signal) }
    }
    for (let page = 0; page < 2000; page++) {
      check(signal)
      const events = items(await rpc(`sync_pull_${endpoints[kind]}_delta`, scoped(id, { p_since_event_id: state.cursor, p_limit: 500 }), signal)) as DeltaEvent[]
      const next = applyCloudDelta(kind, state, events)
      if (events.length && next.cursor <= state.cursor) throw new Error('Nuvio did not advance its sync cursor. Try a full refresh.')
      state = next
      if (events.length < 500) return state
    }
    throw new Error('Nuvio returned too many changes. Try again later.')
  }
  async function upsert(kind: Resource, id: number, values: CloudItem[], origin: string, signal?: AbortSignal) {
    items(values)
    for (let offset = 0; offset < values.length; offset += 500) {
      check(signal)
      await rpc(kind === 'library' ? 'sync_push_library_items' : `sync_push_${endpoints[kind]}`, scoped(id, {
        [kind === 'progress' ? 'p_entries' : 'p_items']: values.slice(offset, offset + 500),
        ...(kind === 'library' ? { p_origin_client_id: origin } : {}),
      }), signal)
    }
  }
  async function remove(kind: Resource, id: number, values: CloudItem[], origin: string, signal?: AbortSignal) {
    items(values)
    const keys = values.map((row) => kind === 'library' ? { content_id: row.content_id, content_type: row.content_type }
      : kind === 'progress' ? nuvioProgressKey(row) : { content_id: row.content_id, ...(row.season != null && row.episode != null ? { season: row.season, episode: row.episode } : {}) })
    for (let offset = 0; offset < keys.length; offset += 500) {
      check(signal)
      await rpc(kind === 'library' ? 'sync_delete_library_items' : `sync_delete_${endpoints[kind]}`, scoped(id, { p_keys: keys.slice(offset, offset + 500), ...(kind === 'library' ? { p_origin_client_id: origin } : {}) }), signal)
    }
  }
  return {
    profiles, saveProfile, deleteProfile, addons, saveAddons, blob, saveBlob, snapshot, refresh, upsert, remove,
    overview: (signal?: AbortSignal) => rpc('get_sync_overview', {}, signal),
    avatars: async (signal?: AbortSignal) => rows(await client.publicRequest('backend', '/rest/v1/rpc/get_avatar_catalog', {}, signal)),
    health: (signal?: AbortSignal) => client.publicRequest('backend', '/functions/v1/health-check', undefined, signal),
    ping: (signal?: AbortSignal) => client.publicRequest('backend', '/rest/v1/rpc/health_ping', {}, signal),
    supporters: (offset = 0, signal?: AbortSignal) => client.publicRequest('website', `/api/supporters/wall?limit=48&offset=${Math.max(0, offset)}`, undefined, signal),
    currentUser: (signal?: AbortSignal) => client.request('backend', '/auth/v1/user', undefined, signal),
  }
}
export const nuvioCloud = createNuvioCloud()
