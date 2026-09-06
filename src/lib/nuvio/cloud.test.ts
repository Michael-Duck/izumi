import { describe, it, expect, vi } from 'vitest'
import { createNuvioCloud, applyCloudDelta, cloudIdentity, sameCloudValue, type CloudItem, type CloudProfile } from './cloud'
import { nuvioClient } from './auth'
vi.mock('$lib/profiles/store', async () => ({ profiledPersisted: (await import('svelte/store')).writable.bind(null, null) }))
const movie = (id = 'tmdb:550'): CloudItem => ({ content_id: id, content_type: 'movie', name: id, added_at: 1000 })
function setup() {
  const request = vi.fn<typeof nuvioClient.request>()
  const publicRequest = vi.fn<typeof nuvioClient.publicRequest>()
  return { request, publicRequest, cloud: createNuvioCloud({ ...nuvioClient, request, publicRequest }) }
}
describe('Nuvio Cloud v1.3', () => {
  it('captures a cursor before every snapshot page and applies concurrent upserts/deletions', async () => {
    const { request, cloud } = setup()
    const page = Array.from({ length: 500 }, (_, id) => movie(String(id)))
    request.mockImplementation(async (_, path, body) => {
      const params = body as Record<string, number>
      if (path.endsWith('_delta_cursor')) return 10
      if (path.endsWith('sync_pull_library')) return params.p_offset === 0 ? page : [movie('501')]
      if (path.endsWith('_delta')) return [{ ...movie('0'), event_id: 11, operation: 'delete' }, { ...movie('new'), event_id: 12, operation: 'upsert' }]
      throw new Error(path)
    })
    const result = await cloud.refresh('library', 6)
    expect(result.cursor).toBe(12)
    expect(result.items).toHaveLength(501)
    expect(result.items.some((row) => row.content_id === '0')).toBe(false)
    expect(request.mock.calls.map(([, path]) => path)).toEqual(['/rest/v1/rpc/sync_get_library_delta_cursor', '/rest/v1/rpc/sync_pull_library', '/rest/v1/rpc/sync_pull_library', '/rest/v1/rpc/sync_pull_library_delta'])
    expect(request.mock.calls.every(([, , body]) => (body as Record<string, number>).p_profile_id === 6)).toBe(true)
    expect(request.mock.calls[2][2]).toEqual({ p_profile_id: 6, p_offset: 500, p_limit: 500 })
  })
  it('paginates watched history with one-based pages', async () => {
    const { request, cloud } = setup()
    request.mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => movie(String(index)))).mockResolvedValueOnce([])
    expect(await cloud.snapshot('history', 2)).toHaveLength(500)
    expect(request.mock.calls[1][2]).toEqual({ p_profile_id: 2, p_page: 2, p_page_size: 500 })
  })
  it('uses the documented latest-200 progress snapshot', async () => {
    const { request, cloud } = setup(); request.mockResolvedValue([])
    await cloud.snapshot('progress', 3)
    expect(request).toHaveBeenCalledWith('backend', '/rest/v1/rpc/sync_pull_watch_progress', { p_profile_id: 3, p_limit: 200 }, undefined)
  })
  it('preserves typed and episode identities when applying out-of-order events', () => {
    const film = movie('shared'), show: CloudItem = { ...film, content_type: 'series', season: 2, episode: 1 }
    const state = { cursor: 2, items: [film, show, { ...show, episode: 2 }] }
    const result = applyCloudDelta('progress', state, [{ ...show, event_id: 4, operation: 'delete' }, { ...film, position: 123, event_id: 3, operation: 'upsert' }])
    expect(result.items).toHaveLength(2)
    expect(result.items.find((row) => row.content_type === 'movie')?.position).toBe(123)
    expect(result.items.find((row) => row.content_type === 'series')?.episode).toBe(2)
    expect(state.items).toHaveLength(3)
  })
  it('does not commit a partial page after a later delta request fails', async () => {
    const { request, cloud } = setup(), initial = { cursor: 10, items: [movie()] }
    request.mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => ({ ...movie(String(index)), event_id: index + 11, operation: 'upsert' }))).mockRejectedValueOnce(new Error('offline'))
    await expect(cloud.refresh('library', 1, initial)).rejects.toThrow('offline')
    expect(initial).toEqual({ cursor: 10, items: [movie()] })
    expect((request.mock.calls[1][2] as Record<string, number>).p_since_event_id).toBe(510)
  })
  it('rejects non-advancing delta pages, invalid identities and invalid profile indexes', async () => {
    const { request, cloud } = setup()
    request.mockResolvedValue([{ ...movie(), event_id: 10, operation: 'upsert' }])
    await expect(cloud.refresh('library', 1, { cursor: 10, items: [] })).rejects.toThrow('advance')
    request.mockResolvedValue([{ content_id: 'x', content_type: 'unknown' }])
    await expect(cloud.snapshot('library', 1)).rejects.toThrow('identity')
    await expect(cloud.snapshot('library', 7)).rejects.toThrow('1 to 6')
  })
  it('batches incremental writes and exact deletions at 500 without a full library replacement', async () => {
    const { request, cloud } = setup(); request.mockResolvedValue(null)
    const values = Array.from({ length: 1001 }, (_, index) => movie(String(index)))
    await cloud.upsert('library', 1, values, 'installation')
    expect(request.mock.calls.map(([, , body]) => (body as { p_items: unknown[] }).p_items.length)).toEqual([500, 500, 1])
    expect(request.mock.calls.every(([, path, body]) => path.endsWith('sync_push_library_items') && (body as Record<string, string>).p_origin_client_id === 'installation')).toBe(true)
    request.mockClear(); await cloud.remove('library', 1, [movie()], 'installation')
    expect(request.mock.calls[0][2]).toEqual({ p_profile_id: 1, p_origin_client_id: 'installation', p_keys: [{ content_id: 'tmdb:550', content_type: 'movie' }] })
  })
  it('uses the documented progress and watched keys', async () => {
    const { request, cloud } = setup(); request.mockResolvedValue(null)
    const episode: CloudItem = { content_id: 'tt123', content_type: 'series', season: 2, episode: 5 }
    await cloud.remove('progress', 2, [episode], 'client')
    await cloud.remove('history', 2, [episode], 'client')
    expect(request.mock.calls[0][2]).toEqual({ p_profile_id: 2, p_keys: ['tt123_s2e5'] })
    expect(request.mock.calls[1][2]).toEqual({ p_profile_id: 2, p_keys: [{ content_id: 'tt123', season: 2, episode: 5 }] })
  })
  it('stops between outbound batches when cancelled', async () => {
    const { request, cloud } = setup(), abort = new AbortController()
    request.mockImplementation(async () => { abort.abort(); return null })
    await expect(cloud.upsert('history', 1, Array.from({ length: 501 }, () => movie()), 'client', abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('preserves all six profile slots and rereads unrelated changes before replacing', async () => {
    const { request, cloud } = setup()
    const values: CloudProfile[] = Array.from({ length: 6 }, (_, id) => ({ profile_index: id + 1, name: `Person ${id + 1}`, avatar_id: `avatar-${id}`, uses_primary_addons: false }))
    request.mockResolvedValueOnce(values).mockResolvedValueOnce(null)
    await cloud.saveProfile({ ...values[1], name: 'New name' }, values[1])
    const body = request.mock.calls[1][2] as { p_client_max_profiles: number; p_profiles: CloudProfile[] }
    expect(body.p_client_max_profiles).toBe(6); expect(body.p_profiles).toHaveLength(6)
    expect(body.p_profiles[5]).toMatchObject(values[5]); expect(body.p_profiles[1].name).toBe('New name')
  })
  it('rejects stale profile changes or newly occupied slots without writing', async () => {
    const { request, cloud } = setup(); const profile = { profile_index: 2, name: 'Someone else' }
    request.mockResolvedValue([profile])
    await expect(cloud.saveProfile({ ...profile, name: 'Mine' }, null)).rejects.toThrow('changed elsewhere')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('checks the reviewed profile before permanently deleting its data', async () => {
    const { request, cloud } = setup(), before = { profile_index: 3, name: 'Old profile' }
    request.mockResolvedValueOnce([{ ...before, name: 'New person' }])
    await expect(cloud.deleteProfile(before)).rejects.toThrow('changed elsewhere')
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce([before]).mockResolvedValueOnce(null)
    await cloud.deleteProfile(before)
    expect(request.mock.calls[2][1]).toBe('/rest/v1/rpc/sync_delete_profile_data')
    expect(request.mock.calls[2][2]).toEqual({ p_profile_id: 3 })
  })
  it('preserves unknown blob fields and scopes each platform independently', async () => {
    const { request, cloud } = setup(), value = { custom: { nested: [1, 2] }, theme: 'dark' }
    request.mockResolvedValueOnce([{ settings_json: value, updated_at: '2026-01-01' }]).mockResolvedValueOnce(null)
    await cloud.saveBlob('settings', 2, { ...value, theme: 'light' }, { value, updatedAt: '2026-01-01' }, 'tv')
    expect(request.mock.calls[1][2]).toEqual({ p_profile_id: 2, p_platform: 'tv', p_settings_json: { custom: { nested: [1, 2] }, theme: 'light' } })
  })
  it('rejects stale and wrong-shaped replacement documents', async () => {
    const { request, cloud } = setup(); request.mockResolvedValue([{ collections_json: [{ id: 'new' }], updated_at: 'new' }])
    await expect(cloud.saveBlob('collections', 1, [], { value: [], updatedAt: 'old' })).rejects.toThrow('changed elsewhere')
    expect(request).toHaveBeenCalledTimes(1)
    await expect(cloud.saveBlob('settings', 1, [], { value: {} })).rejects.toThrow('object')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('saves an explicitly reviewed empty collection list', async () => {
    const { request, cloud } = setup(); const before = [{ id: 'collection', unknown: { keep: true } }]
    request.mockResolvedValueOnce([{ collections_json: before }]).mockResolvedValueOnce(null)
    await cloud.saveBlob('collections', 1, [], { value: before })
    expect(request.mock.calls[1][2]).toEqual({ p_profile_id: 1, p_collections_json: [] })
  })
  it('reads authenticated addon rows without undocumented sync-owner queries', async () => {
    const { request, cloud } = setup(); request.mockResolvedValue([{ url: 'https://addon.test/manifest.json', enabled: false }])
    const result = await cloud.addons(5)
    expect(result[0].enabled).toBe(false)
    expect(request.mock.calls[0][1]).toBe('/rest/v1/addons?select=*&profile_id=eq.5&order=sort_order')
  })
  it('checks the complete addon baseline before writing ordered enabled states', async () => {
    const { request, cloud } = setup(), rows = [{ url: 'https://a.test/manifest.json', enabled: true }, { url: 'https://b.test/manifest.json', enabled: false }]
    request.mockResolvedValueOnce(rows).mockResolvedValueOnce(null)
    await cloud.saveAddons(1, [...rows].reverse(), rows)
    expect(request.mock.calls[1][2]).toMatchObject({ p_profile_id: 1, p_addons: [{ url: rows[1].url, enabled: false, sort_order: 0 }, { url: rows[0].url, enabled: true, sort_order: 1 }] })
  })
  it('separates public endpoints from authenticated account requests', async () => {
    const { cloud, request, publicRequest } = setup(); publicRequest.mockResolvedValue([])
    await cloud.avatars(); await cloud.ping(); await cloud.health(); await cloud.supporters(48)
    expect(request).not.toHaveBeenCalled(); expect(publicRequest).toHaveBeenCalledTimes(4)
    expect(publicRequest.mock.calls[3][1]).toBe('/api/supporters/wall?limit=48&offset=48')
  })
  it('compares nested object values independent of key ordering but preserves array order', () => {
    expect(sameCloudValue({ b: 2, a: { c: 3, d: 4 } }, { a: { d: 4, c: 3 }, b: 2 })).toBe(true)
    expect(sameCloudValue([1, 2], [2, 1])).toBe(false)
    expect(cloudIdentity('library', movie('1'))).not.toBe(cloudIdentity('library', { ...movie('1'), content_type: 'series' }))
  })
})
