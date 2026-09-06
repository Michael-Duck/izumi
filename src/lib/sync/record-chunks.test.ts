import { describe, expect, it } from 'vitest'
import { INLINE_SYNC_BYTES, MAX_SYNC_BYTES, parseChunkManifest, splitSyncPayload } from './record-chunks'

describe('library payload chunk boundaries', () => {
  it('round-trips multibyte titles without splitting UTF-8 or exceeding request budgets', () => {
    const payload = JSON.stringify({ title: '雪❄️アニメ🦊'.repeat(150_000) })
    const chunks = splitSyncPayload(payload)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.join('')).toBe(payload)
    for (const chunk of chunks) expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(INLINE_SYNC_BYTES)
  })
  it('retains unchanged chunk contents after a small edit near the start', () => {
    const entries = Object.fromEntries(Array.from({ length: 15_000 }, (_, i) => [i, { title: `Anime ${i}`, progress: i % 12, synopsis: `Series ${i * 739} in a personal library. `.repeat(5) }]))
    const before = splitSyncPayload(JSON.stringify({ position: 99, entries }))
    const after = splitSyncPayload(JSON.stringify({ position: 100, entries }))
    const reused = after.filter(chunk => before.includes(chunk))
    expect(reused.length).toBeGreaterThan(after.length * .8)
  })
  it('rejects malformed manifests and refuses oversized data without truncation', () => {
    expect(parseChunkManifest('{"history":{}}')).toBeNull()
    expect(() => parseChunkManifest(JSON.stringify({ kind: 'izumi-record-chunks', version: 1, bytes: 4, chunks: ['../bad'] }))).toThrow('manifest')
    expect(() => splitSyncPayload('x'.repeat(MAX_SYNC_BYTES + 1))).toThrow('32 MiB')
  })
})
