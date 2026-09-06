import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import worker from '../src/index.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const ownerToken = 'o'.repeat(43), tvToken = 't'.repeat(43), pairingId = 'p'.repeat(20)
const digest = (value: string) => createHash('sha256').update(value).digest('base64url')

function fixture() {
  const sql = new DatabaseSync(':memory:')
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, dir), 'utf8'))
  sql.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run('owner', digest(ownerToken), 'Test', 1, 1)
  sql.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(pairingId, 'owner', digest(tvToken), 1, 1)
  const salt = 'ab'.repeat(16)
  const profile = { enabled: true, addons: ['https://addon.example'], household: { enabled: true, profiles: [
    { id: 'family', name: 'Family', ratingLimit: 18, allowAdult: false, pin: { salt, hash: createHash('sha256').update(`${salt}:1234`).digest('hex') } },
    { id: 'other', name: 'Other', ratingLimit: 18, allowAdult: false },
  ] } }
  sql.prepare('INSERT INTO resolver_profiles VALUES (?, ?, ?)').run('owner', JSON.stringify(profile), 1)
  const db = { prepare(source: string) {
    let params: (string | number)[] = []
    return { bind(...values: (string | number)[]) { params = values; return this },
      async run() { return { meta: { changes: Number(sql.prepare(source).run(...params).changes) } } },
      async first() { return sql.prepare(source).get(...params) },
      async all() { return { results: sql.prepare(source).all(...params) } },
    }
  } }
  const call = (suffix: string, input: object, token = tvToken) => worker.fetch(new Request(`https://worker.example${suffix}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  }), { DB: db })
  const tv = (action: string, input = {}, profilePin?: string) => call(`/v1/companion/pairings/${pairingId}/accounts`, { action, profileId: 'family', profilePin, ...input })
  return { sql, call, tv }
}

it('gates every account action behind the selected TV profile PIN and isolates connections', async () => {
  const { sql, call, tv } = fixture()
  const network = vi.fn(async () => Response.json({ result: { _id: 'stremio-user', email: 'test@example.test' } }))
  vi.stubGlobal('fetch', network)
  try {
    const linked = await call('/v1/accounts', { service: 'stremio', action: 'connect', profileId: 'family', authKey: 'account-secret' }, ownerToken)
    expect(linked.status).toBe(200)
    network.mockClear()
    for (const action of ['status', 'options', 'progress']) expect((await tv(action)).status).toBe(409)
    expect(network).not.toHaveBeenCalled()
    const options = await (await tv('options', {}, '1234')).json()
    expect(options).toMatchObject({ options: [{ screen: 'account-stremio' }] })
    expect(JSON.stringify(options)).not.toContain('account-secret')
    expect(await (await tv('options', { profileId: 'other' })).json()).toEqual({ options: [] })
    expect(await (await tv('status', {}, '1234')).json()).toEqual({ playbackSync: false })
    expect(network).not.toHaveBeenCalled()
  } finally { sql.close() }
})

it('searches beyond the first library page and returns profile-scoped TV snapshots', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
  const { sql, call } = fixture()
  const library = Array.from({ length: 220 }, (_, index) => ({ _id: `tt${index}`, type: 'movie', name: index === 215 ? 'Needle' : `Film ${index}` }))
  sql.prepare('INSERT INTO connected_accounts (owner_device_id, profile_id, service, connection_json) VALUES (?, ?, ?, ?)').run('owner', 'family', 'stremio', JSON.stringify({ authKey: 'account-secret', profile: 1, cache: { at: Date.now(), library } }))
  const network = vi.fn(); vi.stubGlobal('fetch', network)
  try {
    const input = { profileId: 'family', profilePin: '1234', screen: 'account-stremio' }
    const result = await call(`/v1/companion/pairings/${pairingId}/catalog`, input)
    expect(result.status).toBe(200)
    const data = await result.json()
    expect(data.snapshot).toMatchObject({ profileId: 'family', collectionPage: { hasMore: true, page: 1 } })
    expect(data.snapshot.views.myList).toHaveLength(200)
    const limited = await call(`/v1/companion/pairings/${pairingId}/search`, { ...input, query: 'Needle' })
    expect(limited.status).toBe(429)
    clock.mockReturnValue(Date.now() + 750)
    const search = await call(`/v1/companion/pairings/${pairingId}/search`, { ...input, query: 'Needle' })
    expect(search.status).toBe(200)
    expect(await search.json()).toMatchObject({ items: [{ title: 'Needle' }] })
    expect(network).not.toHaveBeenCalled()
    expect(JSON.stringify(data)).not.toContain('account-secret')
  } finally { sql.close() }
})
