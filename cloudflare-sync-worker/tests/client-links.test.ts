import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import worker from '../src/index.js'
import { companionOwnerDevice } from '../src/client-links.js'

const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
const ownerId = 'original-owner-device', ownerToken = 'o'.repeat(43)
const deviceId = 'fresh-client-device', deviceToken = 'd'.repeat(43)
const pairingId = 'p'.repeat(20), tvToken = 't'.repeat(43)
const otherPairingId = 'q'.repeat(20), otherTvToken = 'u'.repeat(43)
const outsiderId = 'unrelated-device', outsiderToken = 'z'.repeat(43)
const token = digest('a-secret-code-never-sent-to-the-worker')
const secondToken = digest('another-secret-code')
const payload = JSON.stringify({ v: 1, iv: 'i'.repeat(16), data: 'a'.repeat(64) })
const otherPayload = JSON.stringify({ v: 1, iv: 'j'.repeat(16), data: 'b'.repeat(64) })
const base = `/v1/companion/pairings/${pairingId}`
const claimPath = '/v1/companion/client-links/claim'
const salt = 'ab'.repeat(16)
const pin = { salt, hash: createHash('sha256').update(`${salt}:1234`).digest('hex') }
const adult = { id: 'owner-profile', name: 'Owner', ratingLimit: 18, allowAdult: true, pin }
const child = { id: 'child', name: 'Child', ratingLimit: 12, allowAdult: false }
const configuration = { enabled: true, addons: ['https://source.example/private-setting'],
  catalog: { showAdult: true, tmdbToken: 'private-catalog-setting' },
  household: { enabled: true, profiles: [adult, child] } }

const databases: DatabaseSync[] = []
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

// Real SQLite runs every migration and every statement. Batch writes are synchronous inside one
// transaction, matching D1 isolation and rollback; hooks schedule races BEFORE the transaction.
function fixture(profile: object | null = configuration) {
  const sql = new DatabaseSync(':memory:')
  databases.push(sql)
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, dir), 'utf8'))
  const addDevice = (id: string, credential: string) => sql.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run(id, digest(credential), 'Test device', 1, 1)
  addDevice(ownerId, ownerToken)
  addDevice(outsiderId, outsiderToken)
  sql.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(pairingId, ownerId, digest(tvToken), 1, 1)
  sql.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(otherPairingId, outsiderId, digest(otherTvToken), 1, 1)
  if (profile) sql.prepare('INSERT INTO resolver_profiles VALUES (?, ?, ?)').run(ownerId, JSON.stringify(profile), 1)
  type Parameter = string | number | null
  const prepare = (source: string) => {
    let params: Parameter[] = []
    const execute = () => /^\s*SELECT\b/i.test(source)
      ? { results: sql.prepare(source).all(...params), meta: { changes: 0 } }
      : { results: [], meta: { changes: Number(sql.prepare(source).run(...params).changes) } }
    return { source, execute, bind(...values: Parameter[]) { params = values; return this },
      async run() { await db.beforeRun?.(source); return execute() },
      async first() { return sql.prepare(source).get(...params) ?? null },
      async all() { return { results: sql.prepare(source).all(...params) } },
    }
  }
  const db = { prepare,
    beforeRun: undefined as undefined | ((source: string) => void | Promise<void>),
    beforeBatch: undefined as undefined | ((statements: ReturnType<typeof prepare>[]) => void | Promise<void>),
    async batch(statements: ReturnType<typeof prepare>[]) {
      await db.beforeBatch?.(statements)
      sql.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(statement => statement.execute())
        sql.exec('COMMIT')
        return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  const call = (path: string, method = 'GET', input?: unknown, bearer?: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://worker.example${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  }), { DB: db })
  const start = (input: object = {}, bearer = tvToken) => call(`${base}/client-links`, 'POST', {
    token, payload, profileId: adult.id, profilePin: '1234', ...input,
  }, bearer)
  const claim = (input: object = {}) => call(claimPath, 'POST', { token, deviceId, deviceToken, deviceName: 'Restored client', ...input })
  const poll = (linkToken = token, bearer = tvToken) => call(`${base}/client-links`, 'GET', undefined, bearer, { 'X-Izumi-Client-Link': linkToken })
  const cancel = (linkToken = token, bearer = tvToken) => call(`${base}/client-links`, 'DELETE', { token: linkToken }, bearer)
  const row = (table: string) => sql.prepare(`SELECT * FROM ${table}`).all()
  return { sql, db, call, start, claim, poll, cancel, row, addDevice }
}

describe('TV-only link authorization and validation', () => {
  it('advertises the feature and rejects missing, full-device, and wrong-TV bearers on all session methods', async () => {
    const f = fixture()
    expect(await (await f.call('/v1/status')).json()).toMatchObject({ features: expect.arrayContaining(['companion-client-link-v1']) })
    for (const bearer of [undefined, ownerToken, outsiderToken, otherTvToken, 'invalid']) {
      for (const method of ['POST', 'GET', 'DELETE']) {
        expect((await f.call(`${base}/client-links`, method, method === 'GET' ? undefined : { token, payload }, bearer,
          { 'X-Izumi-Client-Link': token })).status).toBe(401)
      }
    }
    expect(f.row('companion_client_links')).toHaveLength(0)
    expect((await f.call('/v1/accounts', 'GET', undefined, tvToken)).status).toBe(401)
    expect((await f.call('/v1/devices/me', 'GET', undefined, tvToken)).status).toBe(401)
    expect((await f.call(claimPath, 'POST', {}, ownerToken)).status).toBe(400)
  })

  it('polls only with the CORS-enabled link header and rejects query tokens even alongside a valid header', async () => {
    const f = fixture()
    await f.start()
    expect(await (await f.poll()).json()).toEqual({ state: 'waiting' })
    expect((await f.call(`${base}/client-links`, 'GET', undefined, tvToken)).status).toBe(400)
    expect((await f.poll('malformed')).status).toBe(400)
    for (const headers of [{}, { 'X-Izumi-Client-Link': token }]) {
      expect((await f.call(`${base}/client-links?token=${token}`, 'GET', undefined, tvToken, headers)).status).toBe(400)
    }
    const options = await f.call(`${base}/client-links`, 'OPTIONS')
    expect(options.status).toBe(204)
    expect(options.headers.get('Access-Control-Allow-Headers')).toContain('X-Izumi-Client-Link')
  })

  it('validates the digest and bounded string envelope before replacing a live session', async () => {
    const f = fixture()
    expect((await f.start()).status).toBe(200)
    for (const invalid of [null, {}, '', 'x'.repeat(42), 'x'.repeat(44), '+'.repeat(43)]) {
      expect((await f.start({ token: invalid })).status).toBe(400)
    }
    for (const invalid of [null, {}, 'plain text', JSON.stringify({ v: 2, iv: 'i'.repeat(16), data: 'a'.repeat(64) }),
      JSON.stringify({ v: 1, iv: 'i'.repeat(15), data: 'a'.repeat(64) }),
      JSON.stringify({ v: 1, iv: 'i'.repeat(16), data: 'a'.repeat(21) }),
      JSON.stringify({ v: 1, iv: 'i'.repeat(16), data: 'a'.repeat(25) }),
      JSON.stringify({ v: 1, iv: 'i'.repeat(16), data: 'a'.repeat(8192) })]) {
      expect((await f.start({ token: secondToken, payload: invalid })).status).toBe(400)
    }
    expect(await (await f.poll()).json()).toEqual({ state: 'waiting' })
    expect(f.row('companion_client_links')).toHaveLength(1)
    expect(f.row('companion_client_links')[0].token_hash).toBe(digest(token))
    const persisted = JSON.stringify(f.row('companion_client_links'))
    expect(persisted).not.toContain(token)
    expect(persisted).not.toContain('1234')
    expect(persisted).not.toContain(tvToken)
    expect((await f.call(`${base}/client-links`, 'POST', null, tvToken)).status).toBe(400)
  })

  it.each([
    ['missing profile', {}, {}],
    ['missing PIN', configuration, { profilePin: undefined }],
    ['wrong PIN', configuration, { profilePin: '0000' }],
    ['child', configuration, { profileId: child.id }],
    ['restricted adult', { ...configuration, household: { enabled: true, profiles: [{ ...adult, allowAdult: false }] } }, {}],
    ['limited rating', { ...configuration, household: { enabled: true, profiles: [{ ...adult, ratingLimit: 16 }] } }, {}],
    ['second adult', { ...configuration, household: { enabled: true, profiles: [adult, { ...adult, id: 'second' }] } }, { profileId: 'second' }],
    ['unprotected first with another PIN', { ...configuration, household: { enabled: true, profiles: [{ ...adult, pin: undefined }, { ...adult, id: 'second' }] } }, {}],
    ['disabled household still locked', { ...configuration, household: { ...configuration.household, enabled: false } }, { profilePin: undefined }],
    ['invalid first profile', { ...configuration, household: { enabled: true, profiles: [{ ...child, id: '!bad' }, adult] } }, {}],
    ['malformed PIN', { ...configuration, household: { enabled: true, profiles: [{ ...adult, pin: { salt: 'bad', hash: 'bad' } }] } }, {}],
    ['empty enabled household', { ...configuration, household: { enabled: true, profiles: [] } }, {}],
  ])('rejects %s without persisting a full-device capability', async (_label, profile, input) => {
    const f = fixture(profile)
    expect((await f.start(input)).status).toBe(403)
    expect(f.row('companion_client_links')).toHaveLength(0)
    expect(f.row('devices')).toHaveLength(2)
  })

  it('accepts an unlocked first adult and an unrestricted household without PINs', async () => {
    const f = fixture({ ...configuration, household: { enabled: true, profiles: [{ ...adult, pin: undefined }, child] } })
    expect((await f.start({ profilePin: undefined })).status).toBe(200)
    expect((await f.claim()).status).toBe(200)
  })

  it('replaces only waiting sessions and scopes cancellation to the authenticated TV and token', async () => {
    const f = fixture()
    await f.start()
    expect((await f.start({ token: secondToken })).status).toBe(200)
    expect(await (await f.poll()).json()).toEqual({ state: 'expired' })
    await f.cancel(token)
    expect(await (await f.poll(secondToken)).json()).toEqual({ state: 'waiting' })
    await f.call(`/v1/companion/pairings/${otherPairingId}/client-links`, 'DELETE', { token: secondToken }, otherTvToken)
    expect(await (await f.poll(secondToken)).json()).toEqual({ state: 'waiting' })
    await f.cancel(secondToken)
    expect((await f.claim({ token: secondToken })).status).toBe(410)
    expect(f.row('devices')).toHaveLength(2)
  })
})

describe('per-TV failed authorization backoff', () => {
  it('counts only failed household authorizations and resets the window on the next failure after expiry', async () => {
    const f = fixture()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const attempts = () => f.row('companion_pairings').find(row => row.pairing_id === pairingId)!
    for (let index = 0; index < 7; index++) expect((await f.start({ token: digest(`valid-${index}`) })).status).toBe(200)
    expect(attempts().client_link_failed_attempts).toBe(0)
    expect(attempts().client_link_retry_at).toBe(0)
    expect((await f.start({ profilePin: '0000', payload: 'invalid' })).status).toBe(400)
    expect((await f.start({ profilePin: '0000' }, otherTvToken)).status).toBe(401)
    expect(attempts().client_link_failed_attempts).toBe(0)
    for (let index = 0; index < 4; index++) expect((await f.start({ profilePin: '0000' })).status).toBe(403)
    expect(attempts().client_link_failed_attempts).toBe(4)
    expect((await f.start()).status).toBe(200)
    expect(attempts().client_link_failed_attempts).toBe(4)
    const fifth = await f.start({ profilePin: '0000' })
    expect(fifth.status).toBe(429)
    expect(fifth.headers.get('Retry-After')).toBe('60')
    expect(await fifth.json()).toMatchObject({ retryAfter: 60 })
    expect((await f.start({ token: secondToken })).status).toBe(429)
    expect(attempts().client_link_failed_attempts).toBe(5)
    expect(await (await f.poll()).json()).toEqual({ state: 'waiting' })
    vi.mocked(Date.now).mockReturnValue(now + 59_000)
    expect(await (await f.start()).json()).toMatchObject({ retryAfter: 1 })
    vi.mocked(Date.now).mockReturnValue(now + 60_000)
    expect((await f.start({ token: secondToken })).status).toBe(200)
    expect((await f.start({ profilePin: '0000' })).status).toBe(403)
    expect(attempts().client_link_failed_attempts).toBe(1)
    expect(attempts().client_link_retry_at).toBe(now + 120_000)
  })

  it('caps concurrent failures in the database and keeps other pairings and existing link claims usable', async () => {
    const f = fixture()
    await f.start()
    const results = await Promise.all(Array.from({ length: 12 }, () => f.start({ profilePin: '0000' })))
    expect(results.filter(response => response.status === 403)).toHaveLength(4)
    expect(results.filter(response => response.status === 429)).toHaveLength(8)
    expect(f.row('companion_pairings').find(row => row.pairing_id === pairingId)?.client_link_failed_attempts).toBe(5)
    expect((await f.call(`/v1/companion/pairings/${otherPairingId}/client-links`, 'POST', { token: secondToken, payload }, otherTvToken)).status).toBe(200)
    expect((await f.claim()).status).toBe(200)
    expect(await (await f.poll()).json()).toEqual({ state: 'linked' })
    await f.cancel()
    f.sql.prepare('UPDATE resolver_profiles SET updated_at = 2 WHERE owner_device_id = ?').run(ownerId)
    expect((await f.start({ token: digest('fresh-after-profile-save') })).status).toBe(429)
  })

  it('rechecks backoff at session insertion without deleting the earlier valid session', async () => {
    const f = fixture()
    await f.start()
    f.db.beforeBatch = async () => {
      f.db.beforeBatch = undefined
      for (let index = 0; index < 5; index++) await f.start({ profilePin: '0000' })
    }
    expect((await f.start({ token: secondToken })).status).toBe(429)
    expect(await (await f.poll()).json()).toEqual({ state: 'waiting' })
    expect(await (await f.poll(secondToken)).json()).toEqual({ state: 'expired' })
  })
})

describe('single-use claims and D1 transaction boundaries', () => {
  it('mints a distinct device, returns full settings, and permits only retries proving the consumed credentials', async () => {
    const f = fixture()
    const original = f.row('devices')[0]
    const started = await (await f.start()).json()
    expect(started.expiresAt - Date.now()).toBeGreaterThan(599_000)
    const response = await f.claim()
    expect(response.status).toBe(200)
    const data = await response.json()
    const status = await (await f.call('/v1/status')).json()
    expect(data).toMatchObject({ payload, recovery: null, ownerDeviceId: ownerId, version: status.version,
      profile: { addons: configuration.addons, catalog: { tmdbToken: 'private-catalog-setting' } } })
    expect(f.row('devices').find(row => row.id === ownerId)).toEqual(original)
    expect(f.row('devices').find(row => row.id === deviceId)).toMatchObject({ token_hash: digest(deviceToken), name: 'Restored client' })
    expect(f.row('companion_client_members')).toEqual([{ pairing_id: pairingId, device_id: deviceId }])
    expect(await (await f.call('/v1/devices/me', 'GET', undefined, deviceToken)).json()).toEqual({ deviceId })
    expect(await (await f.claim()).json()).toEqual(data)
    expect((await f.claim({ deviceToken: outsiderToken })).status).toBe(409)
    expect((await f.claim({ deviceId: 'different-client-device', deviceToken: 'x'.repeat(43) })).status).toBe(409)
    expect(f.row('devices')).toHaveLength(3)
    await f.cancel()
    expect(await (await f.poll()).json()).toEqual({ state: 'linked' })
    expect((await f.start({ token: secondToken })).status).toBe(200)
    expect(await (await f.poll()).json()).toEqual({ state: 'linked' })
    expect(f.row('companion_client_links')).toHaveLength(2)
  })

  it('supports an old independently configured TV with no readable profile or recovery seed', async () => {
    const f = fixture(null)
    expect(await (await f.call(`${base}/client-recovery`, 'GET', undefined, tvToken)).json()).toEqual({ payload: null })
    expect((await f.start({ profileId: undefined, profilePin: undefined })).status).toBe(200)
    expect(await (await f.claim()).json()).toMatchObject({ payload, profile: null, recovery: null, ownerDeviceId: ownerId })
    expect(f.row('companion_client_recovery')).toHaveLength(0)
  })

  it.each([
    { deviceId: ownerId }, { deviceToken: ownerToken }, { deviceToken: tvToken }, { deviceToken: otherTvToken },
  ])('does not reuse an existing identity or turn a TV capability into device authentication: %j', async input => {
    const f = fixture()
    await f.start()
    expect((await f.claim(input)).status).toBe(409)
    expect(f.row('devices')).toHaveLength(2)
    expect(await (await f.poll()).json()).toEqual({ state: 'waiting' })
    expect((await f.claim()).status).toBe(200)
  })

  it('expires both waiting links and consumed retry tombstones at the ten-minute boundary', async () => {
    const f = fixture()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await f.start()
    vi.mocked(Date.now).mockReturnValue(now + 600_000)
    expect((await f.claim()).status).toBe(410)
    expect(await (await f.poll()).json()).toEqual({ state: 'expired' })
    await f.start({ token: secondToken })
    expect((await f.claim({ token: secondToken })).status).toBe(200)
    vi.mocked(Date.now).mockReturnValue(now + 1_200_000)
    expect((await f.claim({ token: secondToken })).status).toBe(410)
    expect(await (await f.poll(secondToken)).json()).toEqual({ state: 'expired' })
  })

  it.each([false, true])('serializes competing claims (same credentials: %s)', async sameCredentials => {
    const f = fixture()
    await f.start()
    let arrivals = 0, release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    f.db.beforeBatch = async () => { if (++arrivals === 2) release(); await ready }
    const responses = await Promise.all([f.claim(), f.claim(sameCredentials ? {} : { deviceId: 'competing-device-id', deviceToken: 'e'.repeat(43) })])
    expect(responses.map(response => response.status).sort()).toEqual(sameCredentials ? [200, 200] : [200, 409])
    expect(f.row('devices')).toHaveLength(3)
    expect(f.row('companion_client_members')).toHaveLength(1)
    const consumed = f.row('companion_client_links')[0].consumed_device_id
    expect(f.row('companion_client_members')[0].device_id).toBe(consumed)
  })

  it.each(['cancel', 'replace', 'revoke', 'profile', 'expire', 'capacity'])('rechecks %s after preflight and before the claim transaction', async change => {
    const f = fixture()
    await f.start()
    f.db.beforeBatch = async () => {
      f.db.beforeBatch = undefined
      if (change === 'cancel') await f.cancel()
      if (change === 'replace') await f.start({ token: secondToken })
      if (change === 'revoke') await f.call(base, 'DELETE', undefined, tvToken)
      if (change === 'profile') f.sql.prepare('UPDATE resolver_profiles SET profile_json = ? WHERE owner_device_id = ?').run(JSON.stringify({ ...configuration, household: { enabled: true, profiles: [child] } }), ownerId)
      if (change === 'expire') f.sql.prepare('UPDATE companion_client_links SET expires_at = ?').run(Date.now() - 1)
      if (change === 'capacity') for (let n = 0; n < 30; n++) f.addDevice(`filler-device-${n}`, `filler-credential-${n}`)
    }
    expect((await f.claim()).status).toBe(409)
    expect(f.row('devices').some(row => row.id === deviceId)).toBe(false)
    expect(f.row('companion_client_members')).toHaveLength(0)
  })

  it('enforces the device limit in competing transactions from different TVs', async () => {
    const f = fixture()
    for (let n = 0; n < 29; n++) f.addDevice(`filler-device-${n}`, `filler-credential-${n}`)
    await f.start()
    await f.call(`/v1/companion/pairings/${otherPairingId}/client-links`, 'POST', { token: secondToken, payload }, otherTvToken)
    const responses = await Promise.all([f.claim(), f.claim({ token: secondToken, deviceId: 'competing-device-id', deviceToken: 'e'.repeat(43) })])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(f.row('devices')).toHaveLength(32)
    expect(f.row('companion_client_members')).toHaveLength(1)
  })

  it('rolls back device creation and consumption if membership insertion fails', async () => {
    const f = fixture()
    await f.start()
    f.sql.exec("CREATE TRIGGER fail_member BEFORE INSERT ON companion_client_members BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    expect((await f.claim()).status).toBe(409)
    expect(f.row('devices')).toHaveLength(2)
    expect(f.row('companion_client_links')[0].consumed_device_id).toBeNull()
    expect(f.row('companion_client_members')).toHaveLength(0)
    f.sql.exec('DROP TRIGGER fail_member')
    expect((await f.claim()).status).toBe(200)
  })

  it('rolls back session replacement on duplicate-token failure', async () => {
    const f = fixture()
    await f.start()
    await f.claim()
    await f.start({ token: secondToken })
    expect((await f.start()).status).toBe(409)
    expect(await (await f.poll(secondToken)).json()).toEqual({ state: 'waiting' })
    expect(await (await f.poll()).json()).toEqual({ state: 'linked' })
  })

  it('invalidates authorization on profile saves, even when the original contents are restored', async () => {
    const f = fixture()
    await f.start()
    f.sql.prepare('UPDATE resolver_profiles SET profile_json = ? WHERE owner_device_id = ?').run(JSON.stringify({ ...configuration, quality: '1080' }), ownerId)
    f.sql.prepare('UPDATE resolver_profiles SET profile_json = ? WHERE owner_device_id = ?').run(JSON.stringify(configuration), ownerId)
    expect((await f.claim()).status).toBe(410)
    expect(await (await f.poll()).json()).toEqual({ state: 'expired' })
    await f.start()
    await f.claim()
    f.sql.prepare('UPDATE resolver_profiles SET updated_at = 2 WHERE owner_device_id = ?').run(ownerId)
    expect((await f.claim()).status).toBe(410)
    expect(await (await f.poll()).json()).toEqual({ state: 'linked' })
  })
})

describe('immutable, opaque recovery', () => {
  it('requires a paired full client for seeding and retains the first ciphertext across different later seeds', async () => {
    const f = fixture()
    for (const bearer of [undefined, tvToken, otherTvToken, outsiderToken]) {
      expect((await f.call(`${base}/client-recovery`, 'PUT', { payload }, bearer)).status).toBe(401)
    }
    expect((await f.call(`${base}/client-recovery`, 'PUT', { payload: {} }, ownerToken)).status).toBe(400)
    expect(await (await f.call(`${base}/client-recovery`, 'PUT', { payload }, ownerToken)).json()).toEqual({ ok: true, stored: true })
    expect(await (await f.call(`${base}/client-recovery`, 'PUT', { payload: otherPayload }, ownerToken)).json()).toEqual({ ok: true, stored: false })
    await f.start()
    expect(await (await f.claim()).json()).toMatchObject({ recovery: payload })
    expect(await (await f.call(`${base}/client-recovery`, 'PUT', { payload: otherPayload }, deviceToken)).json()).toEqual({ ok: true, stored: false })
    for (const bearer of [tvToken, ownerToken, deviceToken]) {
      expect(await (await f.call(`${base}/client-recovery`, 'GET', undefined, bearer)).json()).toEqual({ payload })
    }
    for (const bearer of [undefined, outsiderToken, otherTvToken]) {
      expect((await f.call(`${base}/client-recovery`, 'GET', undefined, bearer)).status).toBe(401)
    }
    expect(f.row('companion_client_recovery')).toEqual([{ pairing_id: pairingId, payload }])
  })

  it('allows a newly linked client to seed once and observes recovery committed before the claim transaction', async () => {
    const f = fixture()
    await f.start()
    f.db.beforeBatch = async () => {
      f.db.beforeBatch = undefined
      await f.call(`${base}/client-recovery`, 'PUT', { payload }, ownerToken)
    }
    expect(await (await f.claim()).json()).toMatchObject({ recovery: payload })
    const g = fixture(null)
    await g.start()
    await g.claim()
    expect(await (await g.call(`${base}/client-recovery`, 'PUT', { payload }, deviceToken)).json()).toEqual({ ok: true, stored: true })
  })

  it('round-trips actual AES-GCM ciphertext without knowing the separate recovery key', async () => {
    const f = fixture()
    const secretKey = randomBytes(32), iv = randomBytes(12)
    const key = await crypto.subtle.importKey('raw', secretKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
    const aad = new TextEncoder().encode(`izumi-companion:${pairingId}:client-recovery`)
    const plaintext = JSON.stringify({ v: 1, groupKey: randomBytes(32).toString('base64url') })
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(plaintext))
    const encrypted = JSON.stringify({ v: 1, iv: iv.toString('base64url'), data: Buffer.from(data).toString('base64url') })
    await f.call(`${base}/client-recovery`, 'PUT', { payload: encrypted }, ownerToken)
    await f.start({ payload: encrypted })
    const restored = await (await f.claim()).json()
    expect(restored.payload).toBe(encrypted)
    expect(restored.recovery).toBe(encrypted)
    const envelope = JSON.parse(restored.recovery)
    expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64url'), additionalData: aad }, key, Buffer.from(envelope.data, 'base64url')))).toBe(plaintext)
    expect(JSON.stringify(f.row('companion_client_recovery'))).not.toContain(plaintext)
    expect(JSON.stringify(f.row('companion_client_links'))).not.toContain(secretKey.toString('base64url'))
  })
})

describe('full-client membership and scoped cleanup', () => {
  it.each(['member leaves', 'TV unlinked'])('preserves owner registration and dependent data until %s', async cleanup => {
    const f = fixture()
    await f.call(`${base}/client-recovery`, 'PUT', { payload }, ownerToken)
    await f.start()
    await f.claim()
    await f.call('/v1/records/watch', 'PUT', { payload }, ownerToken)
    f.sql.prepare('INSERT INTO connected_accounts (owner_device_id, profile_id, service) VALUES (?, ?, ?)').run(ownerId, adult.id, 'stremio')
    const tables = ['companion_pairings', 'companion_client_links', 'companion_client_members', 'companion_client_recovery', 'resolver_profiles', 'connected_accounts', 'records']
    const before = tables.map(f.row)
    const denied = await f.call('/v1/devices/me', 'DELETE', undefined, ownerToken)
    expect(denied.status).toBe(409)
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining('keep the owner registered') })
    expect(tables.map(f.row)).toEqual(before)
    expect((await f.call('/v1/devices/me', 'GET', undefined, ownerToken)).status).toBe(200)
    if (cleanup === 'member leaves') expect((await f.call('/v1/devices/me', 'DELETE', undefined, deviceToken)).status).toBe(200)
    else expect((await f.call(base, 'DELETE', undefined, deviceToken)).status).toBe(200)
    expect((await f.call('/v1/devices/me', 'DELETE', undefined, ownerToken)).status).toBe(200)
  })

  it('checks dependencies across every owned TV and allows unrelated device departure', async () => {
    const f = fixture()
    await f.start()
    await f.claim()
    const newPairingId = 'another-shared-tv-id'
    await f.call('/v1/companion/pairings', 'POST', { pairingId: newPairingId, tvToken: 'v'.repeat(43) }, deviceToken)
    await f.call(base, 'DELETE', undefined, deviceToken)
    expect((await f.call('/v1/devices/me', 'DELETE', undefined, ownerToken)).status).toBe(409)
    expect((await f.call('/v1/devices/me', 'DELETE', undefined, outsiderToken)).status).toBe(200)
    expect(f.row('devices').map(row => row.id).sort()).toEqual([deviceId, ownerId].sort())
  })

  it('rejects owner departure when a client claim commits immediately before the DELETE', async () => {
    const f = fixture()
    await f.start()
    f.db.beforeRun = async source => {
      if (!source.startsWith('DELETE FROM devices')) return
      f.db.beforeRun = undefined
      expect((await f.claim()).status).toBe(200)
    }
    expect((await f.call('/v1/devices/me', 'DELETE', undefined, ownerToken)).status).toBe(409)
    expect(f.row('companion_client_members')).toHaveLength(1)
    expect(f.row('devices')).toHaveLength(3)
    expect(await (await f.poll()).json()).toEqual({ state: 'linked' })
  })

  it('rejects a claim when owner departure commits first', async () => {
    const f = fixture()
    await f.start()
    f.db.beforeBatch = async () => {
      f.db.beforeBatch = undefined
      expect((await f.call('/v1/devices/me', 'DELETE', undefined, ownerToken)).status).toBe(200)
    }
    expect((await f.claim()).status).toBe(409)
    expect(f.row('companion_client_members')).toHaveLength(0)
    expect(f.row('devices').map(row => row.id)).toEqual([outsiderId])
  })

  it('uses shared resolver settings and connected accounts while records stay on the new device', async () => {
    const f = fixture()
    await f.start()
    await f.claim()
    expect(await companionOwnerDevice({ DB: f.db }, deviceId)).toBe(ownerId)
    expect(await companionOwnerDevice({ DB: f.db }, outsiderId)).toBe(outsiderId)
    expect(await (await f.call('/v1/resolver/profile', 'GET', undefined, deviceToken)).json()).toMatchObject({ profile: { addons: configuration.addons } })
    expect((await f.call('/v1/resolver/profile', 'PUT', { ...configuration, quality: '1080' }, deviceToken)).status).toBe(200)
    expect(f.row('resolver_profiles')).toHaveLength(1)
    expect(JSON.parse(String(f.row('resolver_profiles')[0].profile_json)).quality).toBe('1080')
    f.sql.prepare('INSERT INTO connected_accounts (owner_device_id, profile_id, service, connection_json) VALUES (?, ?, ?, ?)')
      .run(ownerId, adult.id, 'stremio', JSON.stringify({ authKey: 'connected-account-secret' }))
    const accountsPath = `/v1/accounts?profileId=${adult.id}`
    expect(await (await f.call(accountsPath, 'GET', undefined, deviceToken)).json()).toEqual(await (await f.call(accountsPath, 'GET', undefined, ownerToken)).json())
    expect((await f.call('/v1/accounts', 'POST', { profileId: adult.id, service: 'stremio', action: 'disconnect' }, deviceToken)).status).toBe(200)
    expect(f.row('connected_accounts').every(row => row.owner_device_id === ownerId)).toBe(true)
    expect((await f.call('/v1/records/watch', 'PUT', { payload }, deviceToken)).status).toBe(200)
    expect(f.row('records')).toMatchObject([{ device_id: deviceId, payload }])
    expect(f.row('companion_pairings').find(row => row.pairing_id === pairingId)).toMatchObject({ owner_device_id: ownerId, tv_token_hash: digest(tvToken) })
  })

  it('reuses an existing pairing without rotating credentials and shares configuration with newly paired TVs', async () => {
    const f = fixture()
    await f.start()
    await f.claim()
    const original = f.row('companion_pairings')
    const pair = (id: string, credential: string) => f.call('/v1/companion/pairings', 'POST', { pairingId: id, tvToken: credential }, deviceToken)
    expect((await pair(pairingId, tvToken)).status).toBe(200)
    expect(f.row('companion_pairings')).toEqual(original)
    expect((await pair(pairingId, 'v'.repeat(43))).status).toBe(409)
    expect((await pair(otherPairingId, otherTvToken)).status).toBe(409)
    const newPairing = 'new-pairing-identifier'
    expect((await pair(newPairing, 'v'.repeat(43))).status).toBe(200)
    expect(f.row('companion_pairings').find(row => row.pairing_id === newPairing)?.owner_device_id).toBe(ownerId)
    expect(f.row('companion_client_members')).toContainEqual({ pairing_id: newPairing, device_id: deviceId })
    expect((await f.call(`/v1/companion/pairings/${newPairing}/snapshots`, 'PUT', { screen: 'auto', payload }, deviceToken)).status).toBe(200)
  })

  it('grants members snapshot/progress/request access and denies unrelated devices and pairings', async () => {
    const f = fixture()
    await f.start()
    await f.claim()
    expect((await f.call(`${base}/snapshots`, 'PUT', { screen: 'auto', payload }, deviceToken)).status).toBe(200)
    for (const bearer of [ownerToken, deviceToken, tvToken]) {
      expect(await (await f.call(`${base}/snapshots`, 'GET', undefined, bearer)).json()).toMatchObject({ payload })
    }
    expect((await f.call(`${base}/progress`, 'PUT', { mediaKey: 'k'.repeat(43), payload }, tvToken)).status).toBe(200)
    expect(await (await f.call(`${base}/progress`, 'GET', undefined, deviceToken)).json()).toMatchObject({ records: [{ payload }] })
    const requestId = 'new-request-identifier'
    expect((await f.call(`${base}/requests/${requestId}`, 'POST', { requestId, payload }, tvToken)).status).toBe(200)
    expect(await (await f.call(`${base}/requests/${requestId}`, 'GET', undefined, deviceToken)).json()).toMatchObject({ payload, state: 'queued' })
    for (const state of ['opened', 'accepted']) {
      expect((await f.call(`${base}/requests/${requestId}/status`, 'POST', { state }, deviceToken)).status).toBe(200)
      expect(await (await f.call(`${base}/requests/${requestId}/status`, 'GET', undefined, deviceToken)).json()).toMatchObject({ state })
    }
    for (const suffix of ['/snapshots', '/progress', `/requests/${requestId}`, `/requests/${requestId}/status`]) {
      expect([401, 404]).toContain((await f.call(`${base}${suffix}`, 'GET', undefined, outsiderToken)).status)
      expect([401, 404]).toContain((await f.call(`/v1/companion/pairings/${otherPairingId}${suffix}`, 'GET', undefined, deviceToken)).status)
    }
    expect((await f.call(`${base}/snapshots`, 'PUT', { screen: 'auto', payload }, outsiderToken)).status).toBe(404)
    expect((await f.call(`${base}/requests/${requestId}/status`, 'POST', { state: 'opened' }, outsiderToken)).status).toBe(404)
  })

  it('leaving a member removes only its own device data, preserving the TV, recovery, owner profile and accounts', async () => {
    const f = fixture()
    await f.call(`${base}/client-recovery`, 'PUT', { payload }, ownerToken)
    await f.start()
    await f.claim()
    for (const bearer of [ownerToken, deviceToken]) await f.call('/v1/records/watch', 'PUT', { payload }, bearer)
    f.sql.prepare('INSERT INTO connected_accounts (owner_device_id, profile_id, service) VALUES (?, ?, ?)').run(ownerId, adult.id, 'stremio')
    expect((await f.call('/v1/resolver/profile', 'DELETE', undefined, deviceToken)).status).toBe(200)
    expect((await f.call('/v1/devices/me', 'DELETE', undefined, deviceToken)).status).toBe(200)
    expect(f.row('devices')).toHaveLength(2)
    expect(f.row('companion_client_members')).toHaveLength(0)
    expect(f.row('records')).toMatchObject([{ device_id: ownerId }])
    expect(f.row('resolver_profiles')).toHaveLength(1)
    expect(f.row('connected_accounts')).toHaveLength(1)
    expect(f.row('companion_pairings')).toHaveLength(2)
    expect(f.row('companion_client_recovery')).toEqual([{ pairing_id: pairingId, payload }])
    expect((await f.claim()).status).toBe(410)
    expect((await f.call('/v1/devices/me', 'GET', undefined, deviceToken)).status).toBe(401)
  })

  it('explicit member pairing removal revokes TV access and link/recovery rows without deleting owner data or device credentials', async () => {
    const f = fixture()
    await f.call(`${base}/client-recovery`, 'PUT', { payload }, ownerToken)
    await f.start()
    await f.claim()
    expect((await f.call(base, 'DELETE', undefined, outsiderToken)).status).toBe(404)
    expect((await f.call(base, 'DELETE', undefined, deviceToken)).status).toBe(200)
    for (const table of ['companion_client_links', 'companion_client_members', 'companion_client_recovery']) expect(f.row(table)).toHaveLength(0)
    expect(f.row('resolver_profiles')).toHaveLength(1)
    expect(f.row('devices')).toHaveLength(3)
    expect((await f.poll()).status).toBe(401)
    expect((await f.call('/v1/devices/me', 'GET', undefined, deviceToken)).status).toBe(200)
    expect(await companionOwnerDevice({ DB: f.db }, deviceId)).toBe(deviceId)
  })
})
