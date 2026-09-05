import { describe, expect, it } from 'vitest'
// The Worker has its own JS/runtime build; don't enroll it in the Svelte application's TS project.
const workerModule = '../../../cloudflare-sync-worker/src/index.js'
const { default: worker } = await import(/* @vite-ignore */ workerModule)
const pairing = 'pairing_1234567890'
const endpoint = 'https://private.example/v1/companion/pairings/' + pairing + '/discovery'
function environment(authorized = true) {
  const statements: string[] = []
  const DB = {
    prepare(sql: string) {
      statements.push(sql)
      return { bind: (..._args: unknown[]) => ({
        first: async () => authorized ? { pairing_id: pairing, owner_device_id: 'owner' } : null,
        run: async () => ({}),
        all: async () => ({ results: [{ mediaKey: 'Q'.repeat(43), payload: 'encrypted' }] }),
      }) }
    },
    batch: async (_statements: unknown[]) => [],
  }
  return { DB, statements }
}
describe('encrypted TV discovery journal', () => {
  it('rejects unauthenticated requests before writing', async () => {
    const env = environment(false)
    const result = await worker.fetch(new Request(endpoint, { method: 'PUT', body: '{}' }), env)
    expect(result.status).toBe(401)
    expect(env.statements.some(sql => sql.startsWith('INSERT'))).toBe(false)
  })
  it('rejects plaintext and accepts a bounded encrypted record in its separate table', async () => {
    const env = environment()
    const request = (payload: string) => new Request(endpoint, { method: 'PUT', headers: { Authorization: 'Bearer ' + 'T'.repeat(43), 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaKey: 'Q'.repeat(43), payload, at: Date.now() }) })
    expect((await worker.fetch(request('private title'), env)).status).toBe(400)
    const payload = JSON.stringify({ v: 1, iv: 'i'.repeat(16), data: 'd'.repeat(64) })
    expect((await worker.fetch(request(payload), env)).status).toBe(200)
    expect(env.statements.some(sql => sql.includes('INSERT INTO companion_discovery'))).toBe(true)
    expect(env.statements.some(sql => sql.includes('companion_progress'))).toBe(false)
    expect(env.statements.some(sql => sql.includes('WHERE excluded.choice_at >= companion_discovery.choice_at'))).toBe(true)
  })
})
