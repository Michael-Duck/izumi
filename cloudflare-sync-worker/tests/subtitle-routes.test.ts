import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import worker from '../src/index.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('delivers only selected subtitles through pairing-scoped links and invalidates an unpaired TV', async () => {
  const sql = new DatabaseSync(':memory:')
  const migrations = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, migrations), 'utf8'))
  const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
  const token = 't'.repeat(43), pairingId = 'p'.repeat(20)
  sql.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run('owner', digest('o'.repeat(43)), 'Test', 1, 1)
  sql.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(pairingId, 'owner', digest(token), 1, 1)
  sql.prepare('INSERT INTO resolver_profiles VALUES (?, ?, ?)').run('owner', JSON.stringify({ enabled: true, addons: ['https://source.example'],
    subtitleServices: [{ kind: 'rest-v1', base: 'https://captions.example', apiKey: 'private-key' }],
  }), 1)
  const DB = { prepare(source: string) {
    let params: (string | number)[] = []
    return { bind(...values: (string | number)[]) { params = values; return this },
      async first() { return sql.prepare(source).get(...params) },
      async run() { return { meta: { changes: Number(sql.prepare(source).run(...params).changes) } } },
      async all() { return { results: sql.prepare(source).all(...params) } },
    }
  } }
  const network = vi.fn(async (input: string) => {
    if (input.endsWith('/manifest.json')) return Response.json({ resources: ['stream'] })
    if (input.includes('/stream/')) return Response.json({ streams: [{ url: 'https://media.example/feature.mp4' }] })
    if (input.includes('/subtitles?')) return Response.json({ data: [{ attributes: { language: 'en', files: [{ file_id: 42, file_name: 'English dialogue' }] } }] })
    if (input.endsWith('/download')) return Response.json({ link: 'https://subs.example/selected.srt' })
    if (input === 'https://subs.example/selected.srt') return new Response('1\n00:00:01,000 --> 00:00:02,000\nHello')
    return Response.json({}, { status: 404 })
  })
  vi.stubGlobal('fetch', network)
  try {
    const response = await worker.fetch(new Request(`https://worker.example/v1/companion/pairings/${pairingId}/resolve`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ ref: { provider: 'tmdb', type: 'movie', id: '123' }, streamType: 'movie', streamIds: ['tt0123456'], title: 'Example Film' }),
    }), { DB })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(JSON.stringify(result)).not.toContain('private-key')
    expect(network.mock.calls.some(([url]) => url.endsWith('/download'))).toBe(false)
    const track = result.candidates[0].subtitles[0]
    expect(track.title).toBe('English dialogue')
    expect(track.url).toContain(`https://worker.example/v1/companion/pairings/${pairingId}/subtitles?ticket=`)
    const subtitle = await worker.fetch(new Request(track.url), { DB })
    expect(subtitle.status).toBe(200)
    expect(await subtitle.text()).toContain('Hello')
    expect(subtitle.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(network.mock.calls.filter(([url]) => url.endsWith('/download'))).toHaveLength(1)
    const wrongPairing = await worker.fetch(new Request(track.url.replace(pairingId, 'q'.repeat(20))), { DB })
    expect(wrongPairing.status).toBe(401)
    sql.prepare('DELETE FROM companion_pairings WHERE pairing_id = ?').run(pairingId)
    expect((await worker.fetch(new Request(track.url), { DB })).status).toBe(401)
    expect(network.mock.calls.filter(([url]) => url.endsWith('/download'))).toHaveLength(1)
  } finally { sql.close() }
})
