// Opaque, content-addressed ciphertext. The Worker never receives a group encryption key.
export const MAX_RECORD_CHUNKS = 512
const MAX_CHUNK_BYTES = 330 * 1024
const MAX_STAGED_BYTES = 96 * 1024 * 1024
const RETAIN_MS = 10 * 60_000
const encoder = new TextEncoder()
export const validChunkId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export const validChunkList = value => Array.isArray(value) && value.length > 0
  && value.length <= MAX_RECORD_CHUNKS && value.every(validChunkId)

export async function putRecordChunk(env, category, deviceId, chunkId, value, json) {
  if (!validChunkId(chunkId) || typeof value.payload !== 'string'
    || encoder.encode(value.payload).byteLength > MAX_CHUNK_BYTES) return json({ error: 'Invalid encrypted library chunk.' }, 413)
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value.payload))
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (actual !== chunkId) return json({ error: 'Library chunk checksum does not match.' }, 400)
  // Readers have time to finish the previous committed manifest. Incomplete uploads expire too,
  // but the active snapshot is never collected, even if its owner has been offline for months.
  await env.DB.prepare(`DELETE FROM record_chunks WHERE category = ? AND device_id = ? AND updated_at < ?
    AND chunk_id NOT IN (SELECT value FROM json_each(COALESCE(
      (SELECT chunk_ids FROM records WHERE category = ? AND device_id = ?), '[]')))`)
    .bind(category, deviceId, Date.now() - RETAIN_MS, category, deviceId).run()
  const result = await env.DB.prepare(`INSERT INTO record_chunks (category, device_id, chunk_id, payload, updated_at)
    SELECT ?, ?, ?, ?, ? WHERE
      COALESCE((SELECT SUM(length(payload)) FROM record_chunks WHERE category = ? AND device_id = ? AND chunk_id != ?), 0) + ? <= ?
    ON CONFLICT(category, device_id, chunk_id) DO UPDATE SET updated_at = excluded.updated_at`)
    .bind(category, deviceId, chunkId, value.payload, Date.now(), category, deviceId, chunkId, encoder.encode(value.payload).byteLength, MAX_STAGED_BYTES).run()
  return Number(result.meta?.changes) ? json({ ok: true })
    : json({ error: 'Library uploads are temporarily full. Retry in ten minutes; your last synced library is safe.' }, 413)
}

export async function commitChunkedRecord(env, category, deviceId, value, json) {
  if (!validChunkList(value.chunks)) return json({ error: 'Invalid library chunk manifest.' }, 400)
  const ids = JSON.stringify([...new Set(value.chunks)])
  // Existence check and pointer swap are one SQLite statement. Interrupted/missing uploads cannot
  // replace the last complete record. Refresh referenced chunks in the same atomic D1 batch.
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO records (category, device_id, payload, updated_at, chunk_ids)
      SELECT ?, ?, ?, ?, ? WHERE
        (SELECT COUNT(*) FROM record_chunks WHERE category = ? AND device_id = ? AND chunk_id IN (SELECT value FROM json_each(?))) = json_array_length(?)
      ON CONFLICT(category, device_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, chunk_ids = excluded.chunk_ids`)
      .bind(category, deviceId, value.payload, Date.now(), ids, category, deviceId, ids, ids),
    env.DB.prepare(`UPDATE record_chunks SET updated_at = ? WHERE category = ? AND device_id = ?
      AND chunk_id IN (SELECT value FROM json_each(?))`)
      .bind(Date.now(), category, deviceId, ids),
  ])
  return Number(results[0]?.meta?.changes) ? json({ ok: true })
    : json({ error: 'The library upload is incomplete. Retry sync to finish it.' }, 409)
}
