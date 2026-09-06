import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import worker from '../src/index.js'
import { tvSourceRequests } from '../src/tv-source-lookup.js'

const pairingId = 'p'.repeat(20), tvToken = 't'.repeat(43), key = 'secret-torbox-credential'
const cachedHash = 'a'.repeat(40), uncachedHash = 'b'.repeat(40)
const input = { ref: { provider: 'tmdb', type: 'movie', id: '808' }, streamIds: ['tt0126029'], tvSourceLookup: 1 }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function fixture() {
  const sql = new DatabaseSync(':memory:')
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, dir), 'utf8'))
  const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
  sql.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run('owner', digest('o'.repeat(43)), 'Test', 1, 1)
  sql.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(pairingId, 'owner', digest(tvToken), 1, 1)
  const profile = { enabled: true, addons: [`https://torrentio.strem.fun/sort=qualitysize|torbox=${key}`], quality: '2160',
    debrid: { provider: 'torbox', credential: key } }
  sql.prepare('INSERT INTO resolver_profiles VALUES (?, ?, ?)').run('owner', JSON.stringify(profile), 1)
  const db = { prepare(source: string) {
    let params: (string | number)[] = []
    return { bind(...values: (string | number)[]) { params = values; return this },
      async run() { return { meta: { changes: Number(sql.prepare(source).run(...params).changes) } } },
      async first() { return sql.prepare(source).get(...params) },
      async all() { return { results: sql.prepare(source).all(...params) } },
    }
  } }
  const call = (payload: object, token = tvToken) => worker.fetch(new Request(`https://worker.example/v1/companion/pairings/${pairingId}/resolve`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload),
  }), { DB: db })
  const fetcher = vi.fn(async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = String(raw)
    if (url.startsWith('https://torrentio.strem.fun/')) return new Response('blocked', { status: 403 })
    if (url.includes('/torrents/checkcached')) return Response.json({ success: true, data: { [cachedHash]: {} } })
    if (url.includes('/torrents/createtorrent')) {
      expect((init?.body as FormData).get('magnet')).toContain(cachedHash)
      return Response.json({ success: true, data: { torrent_id: 42 } })
    }
    if (url.includes('/torrents/mylist')) return Response.json({ success: true, data: [{
      id: 42, download_finished: true, files: [{ id: 0, name: 'Shrek.1080p.mkv', size: 1000 }],
    }] })
    if (url.includes('/torrents/requestdl')) return Response.json({ success: true, data: 'https://cdn.example/Shrek.mkv' })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  return { sql, call, fetcher, profile }
}

function continuation(lookup: { ticket: string; requests: Array<{id: string}> }) {
  return { ...input, tvSourceResults: { ticket: lookup.ticket, results: [{ id: lookup.requests[0].id, streams: [
    { infoHash: uncachedHash, title: 'Shrek 2160p', __cache: 'cached' },
    { infoHash: cachedHash, title: 'Shrek 1080p', url: 'http://127.0.0.1/private', behaviorHints: { filename: 'Shrek.1080p.mkv' } },
  ] }] } }
}

describe('TV-assisted Worker source lookup', () => {
  it('only constructs public Torrentio requests from known non-secret options', () => {
    const requests = tvSourceRequests(`https://torrentio.strem.fun/sort=qualitysize%7Ctorbox=${key}%7Cunknown=secret?token=private`, ['tt0126029', 'tmdb:808'], 'movie', 0)
    expect(requests).toEqual([{ id: 'torrentio-0-0', url: 'https://torrentio.strem.fun/sort=qualitysize/stream/movie/tt0126029.json' }])
    expect(tvSourceRequests('https://addon.example/private', ['tt0126029'], 'movie', 0)).toEqual([])
  })

  it('resolves TV-returned metadata through TorBox without a desktop or repeated cloud scraping', async () => {
    const { sql, call, fetcher } = fixture()
    try {
      const first = await call(input)
      expect(first.status).toBe(200)
      const result = await first.json()
      expect(result.tvSourceLookup.requests).toHaveLength(1)
      expect(JSON.stringify(result)).not.toContain(key)
      const ticketPayload = JSON.parse(Buffer.from(result.tvSourceLookup.ticket.split('.')[0], 'base64url').toString())
      expect(JSON.stringify(ticketPayload)).not.toContain(key)
      fetcher.mockClear()
      const payload = continuation(result.tvSourceLookup)
      const response = await call(payload)
      expect(response.status).toBe(200)
      const resolved = await response.json()
      expect(resolved.candidates[0]).toMatchObject({ url: 'https://cdn.example/Shrek.mkv', source: 'TorBox', delivery: 'debrid' })
      expect(resolved.tvSourceLookup).toBeUndefined()
      expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('https://api.torbox.app/'))).toBe(true)
      expect(JSON.stringify(resolved)).not.toContain(key)
      fetcher.mockClear()
      expect((await call(payload)).status).toBe(409)
      expect(fetcher).not.toHaveBeenCalled()
    } finally { sql.close() }
  })

  it.each(['signature', 'title', 'profile', 'expiry', 'source', 'size', 'superseded', 'token'])('rejects invalid continuation: %s', async change => {
    const { sql, call, fetcher, profile } = fixture()
    try {
      const result = await (await call(input)).json()
      const payload = continuation(result.tvSourceLookup)
      if (change === 'signature') payload.tvSourceResults.ticket = 'x' + payload.tvSourceResults.ticket.slice(1)
      if (change === 'title') payload.ref = { ...input.ref, id: '809' }
      if (change === 'profile') sql.prepare('UPDATE resolver_profiles SET profile_json = ?').run(JSON.stringify({ ...profile, quality: '720' }))
      if (change === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121_000)
      if (change === 'source') payload.tvSourceResults.results[0].id = 'unconfigured-addon'
      if (change === 'size') payload.tvSourceResults.results[0].streams = Array.from({ length: 81 }, () => payload.tvSourceResults.results[0].streams[0])
      if (change === 'superseded') sql.prepare('UPDATE companion_pairings SET last_resolve_at = last_resolve_at + 1').run()
      fetcher.mockClear()
      expect((await call(payload, change === 'token' ? 'wrong-token' : tvToken)).status).toBe(change === 'token' ? 401 : 409)
      expect(fetcher).not.toHaveBeenCalled()
    } finally { sql.close() }
  })

  it('does not offer a continuation to older TVs', async () => {
    const { sql, call } = fixture()
    try { expect((await (await call({ ...input, tvSourceLookup: undefined })).json()).tvSourceLookup).toBeUndefined() }
    finally { sql.close() }
  })
})
