import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const workerPath = '../../../cloudflare-sync-worker/src/index.js'
const { default: worker } = await import(/* @vite-ignore */ workerPath)

// Run the real Worker against SQLite, rather than asserting that expected SQL text exists.
function environment() {
  const sqlite = new DatabaseSync(':memory:')
  for (const name of ['0001_initial', '0006_record_chunks']) {
    sqlite.exec(readFileSync(new URL(`../../../cloudflare-sync-worker/migrations/${name}.sql`, import.meta.url), 'utf8'))
  }
  const DB = {
    prepare(sql: string) {
      const bind = (...values: any[]) => ({
        first: () => sqlite.prepare(sql).get(...values) ?? null,
        all: () => ({ results: sqlite.prepare(sql).all(...values) }),
        run: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
      })
      return { bind, ...bind() }
    },
    async batch(statements: Array<{ run(): unknown }>) {
      sqlite.exec('BEGIN')
      try { const result = statements.map(statement => statement.run()); sqlite.exec('COMMIT'); return result }
      catch (cause) { sqlite.exec('ROLLBACK'); throw cause }
    },
  }
  return { DB, sqlite }
}
const config = {
  enabled: true, endpoint: 'https://private.example', deviceId: 'owner_1234567890abcd',
  deviceToken: 'A'.repeat(43), groupKey: 'B'.repeat(43), workerVersion: '1.9.0',
}
const makePayload = (position = 99, prefix = 'Private anime') => JSON.stringify({
  app: 'izumi', kind: 'watch-history', history: Object.fromEntries(Array.from({ length: 6000 }, (_, id) =>
    [id, { media: { id, title: `${prefix} ${id}`, description: `Series ${id * 739}. `.repeat(12) }, progress: id % 12 }])), position,
})
let env: ReturnType<typeof environment>
let client: typeof import('./cloudflare')
let calls: Array<{ path: string; method: string; bytes: number }>
let failChunk = false
beforeEach(async () => {
  vi.resetModules()
  env = environment()
  const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.deviceToken))).toString('base64url')
  env.sqlite.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run(config.deviceId, tokenHash, 'Test device', 1, 1)
  calls = []
  failChunk = false
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname
    const bytes = new TextEncoder().encode(String(init.body ?? '')).length
    calls.push({ path, method: init.method ?? 'GET', bytes })
    if (failChunk && path.startsWith('/v1/record-chunks/') && init.method === 'PUT') return new Response('{"error":"Simulated offline upload"}', { status: 503 })
    return worker.fetch(new Request(url, init), env)
  })
  client = await import('./cloudflare')
  client.cloudflareSyncConfig.set(config)
})
afterEach(() => { vi.unstubAllGlobals(); env.sqlite.close() })

describe('encrypted multipart library sync', () => {
  it('round-trips a multi-megabyte library with every request below 512 KiB', async () => {
    const payload = makePayload()
    expect(new TextEncoder().encode(payload).length).toBeGreaterThan(1024 * 1024)
    await client.writeCloudflareRecord('watch', payload)
    const records = await client.readCloudflareRecords('watch')
    expect(records).toEqual([{ deviceId: config.deviceId, payload }])
    expect(calls.every(call => call.bytes < 512 * 1024)).toBe(true)
    const stored = env.sqlite.prepare('SELECT payload FROM record_chunks').all()
    expect(stored.length).toBeGreaterThan(2)
    expect(JSON.stringify(stored)).not.toContain('Private anime')
  })

  it('reuses unchanged chunks and avoids writing or downloading unchanged snapshots', async () => {
    await client.writeCloudflareRecord('watch', makePayload())
    const initialUploads = calls.filter(call => call.method === 'PUT' && call.path.includes('/record-chunks/')).length
    calls.length = 0
    await client.writeCloudflareRecord('watch', makePayload(100))
    const editedUploads = calls.filter(call => call.method === 'PUT' && call.path.includes('/record-chunks/')).length
    expect(editedUploads).toBeLessThan(initialUploads / 2)
    calls.length = 0
    await client.writeCloudflareRecord('watch', makePayload(100))
    expect(calls).toEqual([])
    await client.readCloudflareRecords('watch')
    calls.length = 0
    await client.readCloudflareRecords('watch')
    expect(calls.every(call => !call.path.includes('/record-chunks/'))).toBe(true)
  })

  it('keeps the last complete snapshot readable after an interrupted upload and supports retry', async () => {
    const oldPayload = makePayload()
    await client.writeCloudflareRecord('watch', oldPayload)
    failChunk = true
    await expect(client.writeCloudflareRecord('watch', makePayload(1, 'Changed series'))).rejects.toThrow('offline')
    expect((await client.readCloudflareRecords('watch'))[0].payload).toBe(oldPayload)
    failChunk = false
    await client.writeCloudflareRecord('watch', makePayload(1, 'Changed series'))
    expect((await client.readCloudflareRecords('watch'))[0].payload).toBe(makePayload(1, 'Changed series'))
    // Multiple real multi-megabyte encryption rounds need headroom under full-suite CPU load.
  }, 20_000)

  it('refuses to commit a manifest with a missing chunk, without replacing the old record', async () => {
    await client.writeCloudflareRecord('watch', '{"history":{}}')
    const prior = env.sqlite.prepare('SELECT payload FROM records').get()!.payload
    const response = await worker.fetch(new Request(config.endpoint + '/v1/records/watch', {
      method: 'PUT', headers: { Authorization: `Bearer ${config.deviceToken}` },
      body: JSON.stringify({ payload: 'encrypted manifest', chunks: ['f'.repeat(64)] }),
    }), env)
    expect(response.status).toBe(409)
    expect(env.sqlite.prepare('SELECT payload FROM records').get()!.payload).toBe(prior)
  })

  it('rejects corruption and does not let an owner overwrite another device’s chunks', async () => {
    await client.writeCloudflareRecord('watch', makePayload())
    const part = env.sqlite.prepare('SELECT chunk_id FROM record_chunks LIMIT 1').get()!
    const response = await worker.fetch(new Request(`${config.endpoint}/v1/record-chunks/watch/someone_else_123456/${part.chunk_id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${config.deviceToken}` }, body: '{"payload":"bad"}',
    }), env)
    expect(response.status).toBe(403)
    env.sqlite.prepare('UPDATE record_chunks SET payload = ? WHERE chunk_id = ?').run('corrupted', part.chunk_id)
    await expect(client.readCloudflareRecords('watch')).rejects.toThrow('integrity')
  })

  it('keeps legacy small records compatible and asks for a Worker update before a large upload', async () => {
    await client.writeCloudflareRecord('watch', '{"history":{}}')
    expect(await client.readCloudflareRecords('watch')).toEqual([{ deviceId: config.deviceId, payload: '{"history":{}}' }])
    expect(calls.some(call => call.path.includes('record-chunks'))).toBe(false)
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ app: 'izumi-sync', protocol: 1, version: '1.8.0', claimed: true })))
    await expect(client.writeCloudflareRecord('watch', makePayload())).rejects.toThrow('Update your Cloudflare Worker')
  })

  it('collects expired staging data while retaining the active snapshot of an offline device', async () => {
    await client.writeCloudflareRecord('watch', makePayload())
    env.sqlite.prepare('UPDATE record_chunks SET updated_at = 0').run()
    env.sqlite.prepare('INSERT INTO record_chunks VALUES (?, ?, ?, ?, ?)').run('watch', config.deviceId, 'f'.repeat(64), 'abandoned upload', 0)
    await client.writeCloudflareRecord('watch', makePayload(100))
    expect(env.sqlite.prepare('SELECT chunk_id FROM record_chunks WHERE chunk_id = ?').get('f'.repeat(64))).toBeUndefined()
    expect((await client.readCloudflareRecords('watch'))[0].payload).toBe(makePayload(100))
  })
})
