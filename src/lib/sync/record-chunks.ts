// Content-defined boundaries resynchronize after a small JSON edit. Subsequent unchanged chunks
// keep their ciphertext identities, even when an earlier title or resume position changes length.
export const MAX_SYNC_BYTES = 32 * 1024 * 1024
export const MAX_RECORD_CHUNKS = 512
export const INLINE_SYNC_BYTES = 240 * 1024
const MIN_CHUNK_BYTES = 64 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const gear = Array.from({ length: 256 }, (_, i) => {
  let value = Math.imul(i + 1, 0x9e3779b1)
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  return (value ^ (value >>> 16)) >>> 0
})

export interface ChunkManifest {
  kind: 'izumi-record-chunks'
  version: 1
  bytes: number
  chunks: string[]
}
export function parseChunkManifest(payload: string): ChunkManifest | null {
  const value = JSON.parse(payload)
  if (value?.kind !== 'izumi-record-chunks') return null
  if (value.version !== 1 || !Number.isInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_SYNC_BYTES
    || !Array.isArray(value.chunks) || !value.chunks.length || value.chunks.length > MAX_RECORD_CHUNKS
    || !value.chunks.every((id: unknown) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) {
    throw new Error('Invalid encrypted library manifest.')
  }
  return value as ChunkManifest
}
export function splitSyncPayload(payload: string): string[] {
  const bytes = encoder.encode(payload)
  if (bytes.length > MAX_SYNC_BYTES) throw new Error('This library exceeds the 32 MiB sync limit. Export a backup; your local library is unchanged.')
  const chunks: string[] = []
  let start = 0
  let rolling = 0
  for (let i = 0; i < bytes.length; i++) {
    rolling = ((rolling << 1) + gear[bytes[i]]) >>> 0
    const length = i + 1 - start
    if (length >= INLINE_SYNC_BYTES - 4 || (length >= MIN_CHUNK_BYTES && (rolling & 0x1fff) === 0)) {
      // Never split a UTF-8 code point; the cipher accepts each chunk as a string.
      let end = i + 1
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++
      chunks.push(decoder.decode(bytes.subarray(start, end)))
      start = end
      i = end - 1
      rolling = 0
    }
  }
  if (start < bytes.length || !chunks.length) chunks.push(decoder.decode(bytes.subarray(start)))
  if (chunks.length > MAX_RECORD_CHUNKS) throw new Error('The library has too many sync chunks.')
  return chunks
}
export async function chunkHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
