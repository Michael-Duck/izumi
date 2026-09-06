import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { accountMedia, accountSources, manageAccount, nuvioApi, progressEntry, publicAccount, pullAccount, pushAccountProgress, readAccounts, serviceJson, withAccount } from '../src/accounts.js'
import worker from '../src/index.js'

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const nuvio = () => ({ session: { accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 3600000 }, profile: 2, sources: true, playback: true })
const media = { ref: { provider: 'stremio', type: 'series', id: encodeURIComponent(JSON.stringify(['addon', 'series', 'tt1234'])) }, resolver: { nativeType: 'series', videoId: 'tt1234:0:3' }, title: 'Example', season: 0, episode: 3 }
const progress = () => ({ media, positionSeconds: 210.5, durationSeconds: 1800, updatedAt: Date.now() })
afterEach(() => vi.unstubAllGlobals())

function database() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON; CREATE TABLE devices(id TEXT PRIMARY KEY); INSERT INTO devices VALUES (\'owner\'), (\'other\');')
  sql.exec(readFileSync(new URL('../migrations/0007_connected_accounts.sql', import.meta.url), 'utf8'))
  return { sql, db: { prepare(source: string) { return { bind(...params: (string | number)[]) { return {
    async run() { const result = sql.prepare(source).run(...params); return { meta: { changes: Number(result.changes) } } },
    async first() { return sql.prepare(source).get(...params) }, async all() { return { results: sql.prepare(source).all(...params) } },
  } } } } } }
}

describe('private Worker account storage', () => {
  it('isolates accounts by owner and profile, serializes writes, and cascades owner deletion', async () => {
    const { sql, db } = database()
    try {
      await withAccount(db, 'owner', 'family', 'nuvio', async (account, save) => {
        Object.assign(account, nuvio()); await save()
        await expect(withAccount(db, 'owner', 'family', 'nuvio', async () => {})).rejects.toThrow('busy')
        await withAccount(db, 'owner', 'default', 'nuvio', async () => {})
      })
      expect((await readAccounts(db, 'owner', 'family'))[0].connected).toBe(true)
      expect((await readAccounts(db, 'owner', 'default'))[0].connected).toBe(false)
      expect((await readAccounts(db, 'other', 'family'))[0].connected).toBe(false)
      expect(JSON.stringify(await readAccounts(db, 'owner', 'family'))).not.toContain('secret')
      sql.prepare('DELETE FROM devices WHERE id=?').run('owner')
      expect(sql.prepare('SELECT * FROM connected_accounts').all()).toEqual([])
    } finally { sql.close() }
  })
  it('releases its lease after a failed upstream request', async () => {
    const { sql, db } = database()
    try {
      await expect(withAccount(db, 'owner', 'default', 'nuvio', async () => { throw new Error('offline') })).rejects.toThrow('offline')
      await expect(withAccount(db, 'owner', 'default', 'nuvio', async () => 'ready')).resolves.toBe('ready')
    } finally { sql.close() }
  })
  it('does not allow unauthenticated owner or TV calls to reach external services', async () => {
    const upstream = vi.fn(); vi.stubGlobal('fetch', upstream)
    const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) }
    const owner = await worker.fetch(new Request('https://worker.example/v1/accounts'), { DB: db })
    expect(owner.status).toBe(401)
    const tv = await worker.fetch(new Request('https://worker.example/v1/companion/pairings/abcdefghijklmnop/accounts', { method: 'POST', body: JSON.stringify({ action: 'status' }) }), { DB: db })
    expect(tv.status).toBeGreaterThanOrEqual(400)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('Nuvio dedicated session', () => {
  it('persists rotated tokens before a later API failure', async () => {
    const account = nuvio(); account.session.expiresAt = 0
    const saved: unknown[] = []
    const fetcher = vi.fn(async (url: string) => url.includes('grant_type=refresh_token') ? reply({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }) : reply({}, 503))
    await expect(nuvioApi(account, async () => { saved.push(structuredClone(account)) }, fetcher)('/rest/v1/rpc/sync_pull_profiles', {})).rejects.toThrow('503')
    expect(saved).toMatchObject([{ session: { refreshToken: 'new-refresh' } }])
    expect(fetcher.mock.calls).toHaveLength(2)
  })
  it('refreshes once when a previously valid access token is rejected', async () => {
    let attempt = 0
    const fetcher = vi.fn(async (url: string) => url.includes('grant_type=') ? reply({ access_token: 'new', refresh_token: 'new-refresh' }) : ++attempt === 1 ? reply({}, 401) : reply([]))
    await expect(nuvioApi(nuvio(), async () => {}, fetcher)('/rest/v1/rpc/sync_pull_profiles', {})).resolves.toEqual([])
    expect(attempt).toBe(2)
  })
  it('never echoes upstream bodies containing credentials', async () => {
    await expect(serviceJson('https://api.strem.io/api/getUser', {}, undefined, async () => reply({ error: { message: 'access-secret' } }))).rejects.not.toThrow('access-secret')
    await expect(serviceJson('https://evil.example/api', {}, 'access-secret', vi.fn())).rejects.toThrow('Invalid account service')
    expect(JSON.stringify(publicAccount(nuvio(), 'nuvio'))).not.toContain('secret')
  })
  it('refuses foreign device links and preserves the original connection', async () => {
    const account = {}
    await expect(manageAccount(account, async () => {}, () => {}, 'nuvio', { action: 'link' }, async () => reply([{ device_code: 'device', user_code: 'ABC123', verification_uri_complete: 'https://evil.example/link' }]))).rejects.toThrow('invalid sign-in link')
    expect(account).toEqual({})
  })
  it('uses primary add-ons for an inheriting profile without changing its personal library', async () => {
    const fetcher = vi.fn(async (url: string) => url.includes('sync_pull_profiles') ? reply([{ profile_index: 2, uses_primary_addons: true }]) : reply([{ url: 'https://addon.example/manifest.json?key=secret', enabled: true }]))
    const account = nuvio()
    expect(await accountSources(account, async () => {}, 'nuvio', fetcher)).toEqual(['https://addon.example/?key=secret'])
    expect(fetcher.mock.calls[1][0]).toContain('profile_id=eq.1')
    expect(account.profile).toBe(2)
  })
  it('blocks a Nuvio profile that gained a PIN even while its cache is fresh', async () => {
    const account = { ...nuvio(), cache: { at: Date.now(), library: [] } }
    await expect(pullAccount(account, async () => {}, 'nuvio', async () => reply([{ profile_index: 2, pin_enabled: true }]))).rejects.toThrow('locked')
  })
  it('captures the cursor before snapshots and replays deletes from that cursor', async () => {
    const names: string[] = [], bodies: Record<string, unknown>[] = []
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const name = url.split('/').pop()!; names.push(name); bodies.push(JSON.parse(String(init.body || '{}')))
      if (name === 'sync_pull_profiles') return reply([{ profile_index: 2 }])
      if (name.includes('_delta_cursor')) return reply(41)
      if (name === 'sync_pull_library') return reply([{ content_type: 'movie', content_id: 'tt1', name: 'Deleted elsewhere' }])
      if (name === 'sync_pull_library_delta') return reply([{ event_id: 42, operation: 'delete', content_type: 'movie', content_id: 'tt1' }])
      if (name === 'sync_pull_collections') return reply([{ collections_json: [] }])
      return reply([])
    })
    const data = await pullAccount({ ...nuvio(), sources: false }, async () => {}, 'nuvio', fetcher)
    expect(data.library).toEqual([])
    expect(names.indexOf('sync_get_library_delta_cursor')).toBeLessThan(names.indexOf('sync_pull_library'))
    expect(bodies[names.indexOf('sync_pull_library_delta')].p_since_event_id).toBe(41)
  })
})

describe('TV playback interoperability', () => {
  it('uses milliseconds and exact season zero coordinates', () => {
    expect(progressEntry(progress())).toMatchObject({ content_id: 'tt1234', content_type: 'series', season: 0, episode: 3, video_id: 'tt1234:0:3', position: 210500, duration: 1800000 })
    expect(progressEntry({ ...progress(), media: { ...media, season: undefined } })).toBeNull()
    expect(() => progressEntry({ ...progress(), positionSeconds: Infinity })).toThrow('Invalid')
  })
  it('maps resumed Nuvio and Stremio episodes with seconds at the TV boundary', () => {
    expect(accountMedia({ content_id: 'tt1234', content_type: 'series', video_id: 'tt1234:0:3', name: 'Example', position: 210500, duration: 1800000 }, 'nuvio', 'https://addon.example')).toMatchObject({ season: 0, episode: 3, resumePositionSeconds: 210.5 })
    expect(accountMedia({ _id: 'tt1234', type: 'series', name: 'Example', state: { video_id: 'tt1234:2:1', timeOffset: 120000, duration: 1800000 } }, 'stremio', 'https://addon.example')).toMatchObject({ season: 2, episode: 1, resumePositionSeconds: 120 })
  })
  it('does not send external progress without opt-in', async () => {
    const fetcher = vi.fn()
    expect(await pushAccountProgress({ ...nuvio(), playback: false }, async () => {}, 'nuvio', progress(), fetcher)).toEqual({ skipped: true })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('preserves Stremio library flags and unknown state fields during item-level updates', async () => {
    const original = { _id: 'tt1234', name: 'Example', type: 'series', removed: false, temp: false, _mtime: '2020-01-01T00:00:00Z', state: { watched: 'existing-bitfield', timesWatched: 9, custom: 'keep' } }
    const fetcher = vi.fn(async (url: string, _init: RequestInit) => reply({ result: url.endsWith('datastoreGet') ? [original] : { success: true } }))
    await pushAccountProgress({ authKey: 'secret', playback: true, profile: 1 }, async () => {}, 'stremio', progress(), fetcher)
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    expect(body.collection).toBe('libraryItem')
    expect(body.changes).toHaveLength(1)
    expect(body.changes[0]).toMatchObject({ removed: false, temp: false, state: { watched: 'existing-bitfield', timesWatched: 9, custom: 'keep', timeOffset: 210500 } })
  })
  it('does not overwrite progress already updated by another device', async () => {
    const input = progress()
    const fetcher = vi.fn(async () => reply({ result: [{ _mtime: new Date(input.updatedAt + 1).toISOString() }] }))
    expect(await pushAccountProgress({ authKey: 'secret', playback: true, profile: 1 }, async () => {}, 'stremio', input, fetcher)).toEqual({ skipped: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
