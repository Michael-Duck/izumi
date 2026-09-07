import { viewerForRequest } from './profiles.js'

const TTL_MS = 10 * 60 * 1000
const MAX_PAYLOAD_BYTES = 8 * 1024
const MAX_FAILED_ATTEMPTS = 5
const FAILURE_WINDOW_MS = 60_000
const encoder = new TextEncoder()
const validLinkToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)

function validEnvelope(value) {
  if (typeof value !== 'string' || encoder.encode(value).byteLength > MAX_PAYLOAD_BYTES) return false
  try {
    const envelope = JSON.parse(value)
    return envelope?.v === 1 && typeof envelope.iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(envelope.iv)
      && typeof envelope.data === 'string' && /^[A-Za-z0-9_-]{22,}$/.test(envelope.data)
      && envelope.data.length % 4 !== 1
  } catch { return false }
}

/** Membership grants shared TV configuration access, never a replacement device identity. */
export async function companionOwnerDevice(env, deviceId) {
  const row = await env.DB.prepare(`SELECT p.owner_device_id FROM companion_client_members m
    JOIN companion_pairings p ON p.pairing_id = m.pairing_id WHERE m.device_id = ? LIMIT 1`).bind(deviceId).first()
  return row ? String(row.owner_device_id) : deviceId
}

export function companionMemberPairing(env, deviceId, pairingId) {
  return env.DB.prepare(`SELECT p.pairing_id, p.owner_device_id FROM companion_pairings p
    WHERE p.pairing_id = ? AND (p.owner_device_id = ? OR EXISTS
      (SELECT 1 FROM companion_client_members m WHERE m.pairing_id = p.pairing_id AND m.device_id = ?))`)
    .bind(pairingId, deviceId, deviceId).first()
}

async function context(env, pairingId) {
  return env.DB.prepare(`SELECT p.pairing_id, p.owner_device_id, p.tv_token_hash,
    p.client_link_failed_attempts, p.client_link_retry_at,
    r.profile_json, r.updated_at FROM companion_pairings p
    LEFT JOIN resolver_profiles r ON r.owner_device_id = p.owner_device_id WHERE p.pairing_id = ?`)
    .bind(pairingId).first()
}

function authorizationValue(row) {
  return JSON.stringify([row.owner_device_id, row.tv_token_hash, row.profile_json, row.updated_at])
}

/** Full-account access requires the first saved, unrestricted household profile, including when
 * household mode is temporarily disabled. PIN input is checked in memory and never persisted. */
async function authorizeProfile(profile, input) {
  const household = profile?.household
  if (!household) return
  if (!household.profiles.length && !household.enabled) return
  const owner = household.profiles[0]
  if (!owner || owner.id !== input.profileId || owner.ratingLimit !== 18 || owner.allowAdult !== true) {
    throw new Error('Unlock the first unrestricted household profile to link a full client.')
  }
  if (!owner.pin && household.profiles.some(profile => profile.pin)) {
    throw new Error('Protect the first household profile with a PIN before linking a full client.')
  }
  await viewerForRequest({ ...profile, catalog: { ...profile.catalog }, household: { ...household, enabled: true } }, input)
}

// Keep HTTP/authentication conventions in index.js; all link transactions live here.
export function createClientLinkApi({ authenticateTv, ownerPairing, body, json, hash, validId,
  validToken, cleanName, normalizeResolverProfile, version, maxDevices }) {
  const expired = () => json({ error: 'This client link is unavailable or has expired.' }, 410)
  const conflict = () => json({ error: 'This client link was used, the device already exists, or the device limit was reached.' }, 409)
  const blocked = row => row && Number(row.client_link_failed_attempts) >= MAX_FAILED_ATTEMPTS && Number(row.client_link_retry_at) > Date.now()
  const backoff = row => {
    const retryAfter = Math.max(1, Math.ceil((Number(row.client_link_retry_at) - Date.now()) / 1000))
    const response = json({ error: 'Too many failed profile unlock attempts. Wait before trying again.', retryAfter }, 429)
    response.headers.set('Retry-After', String(retryAfter))
    return response
  }
  const profileFrom = (row, request) => {
    if (row.profile_json === null) return null
    const raw = JSON.parse(row.profile_json)
    const profile = normalizeResolverProfile(raw, new URL(request.url).origin)
    // Normalization may discard invalid entries. Never silently promote a different owner.
    if (raw.household && (!Array.isArray(raw.household.profiles)
      || raw.household.profiles.length !== profile.household?.profiles.length
      || new Set(profile.household.profiles.map(item => item.id)).size !== profile.household.profiles.length)) {
      throw new Error('Invalid household configuration.')
    }
    return profile
  }

  async function links(request, env, pairingId) {
    if (!await authenticateTv(request, env, pairingId)) return json({ error: 'TV authentication failed.' }, 401)
    if (request.method === 'GET' && new URL(request.url).searchParams.has('token')) {
      return json({ error: 'Send the client link token in the X-Izumi-Client-Link header, never in the URL.' }, 400)
    }
    const input = request.method === 'GET' ? { token: request.headers.get('X-Izumi-Client-Link') } : await body(request)
    if (!validLinkToken(input?.token)) return json({ error: 'Invalid client link token.' }, 400)
    const tokenHash = await hash(input.token)
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM companion_client_links WHERE pairing_id = ? AND token_hash = ? AND consumed_device_id IS NULL')
        .bind(pairingId, tokenHash).run()
      return json({ ok: true })
    }
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT authorization_hash, consumed_device_id, expires_at FROM companion_client_links WHERE pairing_id = ? AND token_hash = ?')
        .bind(pairingId, tokenHash).first()
      if (!row || Number(row.expires_at) <= Date.now()) return json({ state: 'expired' })
      // Keep the consumed tombstone visible even if the restored client immediately saves settings.
      if (row.consumed_device_id) return json({ state: 'linked' })
      const current = await context(env, pairingId)
      return json({ state: current && await hash(authorizationValue(current)) === row.authorization_hash ? 'waiting' : 'expired' })
    }
    if (!validEnvelope(input.payload)) return json({ error: 'Invalid encrypted client link payload (maximum 8192 bytes).' }, 400)
    const current = await context(env, pairingId)
    if (!current || current.tv_token_hash !== await hash(request.headers.get('authorization').slice(7))) return expired()
    if (blocked(current)) return backoff(current)
    try { await authorizeProfile(profileFrom(current, request), input) }
    catch {
      const failedAt = Date.now()
      // Atomically cap failures, including concurrent guesses. Valid requests never increment or
      // reset the counter; profile saves and link cancellation cannot bypass the current window.
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE companion_pairings SET
          client_link_failed_attempts = CASE WHEN client_link_retry_at <= ? THEN 1 ELSE client_link_failed_attempts + 1 END,
          client_link_retry_at = CASE WHEN client_link_retry_at <= ? THEN ? ELSE client_link_retry_at END
          WHERE pairing_id = ? AND tv_token_hash = ? AND (client_link_retry_at <= ? OR client_link_failed_attempts < ?)`)
          .bind(failedAt, failedAt, failedAt + FAILURE_WINDOW_MS, pairingId, current.tv_token_hash, failedAt, MAX_FAILED_ATTEMPTS),
        env.DB.prepare('SELECT client_link_failed_attempts, client_link_retry_at FROM companion_pairings WHERE pairing_id = ? AND tv_token_hash = ?')
          .bind(pairingId, current.tv_token_hash),
      ])
      const limited = results[1]?.results?.[0]
      if (!limited) return expired()
      if (blocked(limited)) return backoff(limited)
      return json({ error: 'Unlock the first unrestricted household profile with its PIN before linking a full client.' }, 403)
    }
    const authorizationHash = await hash(authorizationValue(current))
    const now = Date.now(), expiresAt = now + TTL_MS
    try {
      const results = await env.DB.batch([
        env.DB.prepare('DELETE FROM companion_client_links WHERE expires_at <= ?').bind(now),
        env.DB.prepare(`DELETE FROM companion_client_links WHERE pairing_id = ? AND consumed_device_id IS NULL AND token_hash <> ?
          AND EXISTS (SELECT 1 FROM companion_pairings p WHERE p.pairing_id = companion_client_links.pairing_id
            AND (p.client_link_retry_at <= ? OR p.client_link_failed_attempts < ?))`).bind(pairingId, tokenHash, now, MAX_FAILED_ATTEMPTS),
        env.DB.prepare(`INSERT INTO companion_client_links (token_hash, pairing_id, payload, authorization_hash, expires_at)
          SELECT ?, p.pairing_id, ?, ?, ? FROM companion_pairings p
          LEFT JOIN resolver_profiles r ON r.owner_device_id = p.owner_device_id
          WHERE p.pairing_id = ? AND p.owner_device_id = ? AND p.tv_token_hash = ?
            AND r.profile_json IS ? AND r.updated_at IS ?
            AND (p.client_link_retry_at <= ? OR p.client_link_failed_attempts < ?)`)
          .bind(tokenHash, input.payload, authorizationHash, expiresAt, pairingId, current.owner_device_id,
            current.tv_token_hash, current.profile_json, current.updated_at, now, MAX_FAILED_ATTEMPTS),
      ])
      if (Number(results[2]?.meta?.changes) !== 1) {
        const latest = await context(env, pairingId)
        return blocked(latest) ? backoff(latest) : expired()
      }
    } catch { return json({ error: 'This client link token already exists. Generate a new code.' }, 409) }
    return json({ ok: true, state: 'waiting', expiresAt })
  }

  async function claim(request, env) {
    const input = await body(request)
    if (!validLinkToken(input?.token) || !validId(input?.deviceId) || !validToken(input?.deviceToken)) {
      return json({ error: 'Invalid client link or device credentials.' }, 400)
    }
    const tokenHash = await hash(input.token), deviceHash = await hash(input.deviceToken)
    const link = await env.DB.prepare('SELECT * FROM companion_client_links WHERE token_hash = ?').bind(tokenHash).first()
    if (!link || Number(link.expires_at) <= Date.now()) return expired()
    const current = await context(env, link.pairing_id)
    if (!current || await hash(authorizationValue(current)) !== link.authorization_hash) return expired()
    let profile
    try { profile = profileFrom(current, request) } catch { return expired() }

    // The same guarded SELECT also serves retries; an existing ID alone is never proof of a claim.
    const responseQuery = () => env.DB.prepare(`SELECT l.payload, l.consumed_device_id,
      recovery.payload AS recovery FROM companion_client_links l
      JOIN companion_pairings p ON p.pairing_id = l.pairing_id
      JOIN devices d ON d.id = l.consumed_device_id
      JOIN companion_client_members m ON m.pairing_id = l.pairing_id AND m.device_id = d.id
      LEFT JOIN companion_client_recovery recovery ON recovery.pairing_id = l.pairing_id
      LEFT JOIN resolver_profiles r ON r.owner_device_id = p.owner_device_id
      WHERE l.token_hash = ? AND l.consumed_device_id = ? AND d.token_hash = ?
        AND l.expires_at > MAX(?, (julianday('now') - 2440587.5) * 86400000)
        AND p.owner_device_id = ? AND p.tv_token_hash = ? AND r.profile_json IS ? AND r.updated_at IS ?`)
      .bind(tokenHash, input.deviceId, deviceHash, Date.now(), current.owner_device_id, current.tv_token_hash,
        current.profile_json, current.updated_at)
    const response = row => row && row.consumed_device_id === input.deviceId
      ? json({ payload: row.payload, recovery: row.recovery ?? null, profile, ownerDeviceId: String(current.owner_device_id), version })
      : conflict()
    if (link.consumed_device_id) return response(await responseQuery().first())

    const now = Date.now()
    try {
      // D1 batches are transactions. changes() chains each write to this batch's successful insert,
      // preventing a stale read, cancellation, or competing claim from minting an orphan device.
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO devices (id, token_hash, name, created_at, last_seen)
          SELECT ?, ?, ?, ?, ? FROM companion_client_links l
          JOIN companion_pairings p ON p.pairing_id = l.pairing_id
          LEFT JOIN resolver_profiles r ON r.owner_device_id = p.owner_device_id
          WHERE l.token_hash = ? AND l.consumed_device_id IS NULL
            AND l.expires_at > MAX(?, (julianday('now') - 2440587.5) * 86400000)
            AND l.authorization_hash = ? AND p.owner_device_id = ? AND p.tv_token_hash = ?
            AND r.profile_json IS ? AND r.updated_at IS ?
            AND (SELECT COUNT(*) FROM devices) < ?
            AND NOT EXISTS (SELECT 1 FROM companion_pairings WHERE tv_token_hash = ?)`)
          .bind(input.deviceId, deviceHash, cleanName(input.deviceName), now, now, tokenHash, now,
            link.authorization_hash, current.owner_device_id, current.tv_token_hash,
            current.profile_json, current.updated_at, maxDevices, deviceHash),
        env.DB.prepare(`UPDATE companion_client_links SET consumed_device_id = ?
          WHERE token_hash = ? AND consumed_device_id IS NULL AND changes() = 1`).bind(input.deviceId, tokenHash),
        env.DB.prepare(`INSERT INTO companion_client_members (pairing_id, device_id)
          SELECT pairing_id, consumed_device_id FROM companion_client_links
          WHERE token_hash = ? AND consumed_device_id = ? AND changes() = 1`).bind(tokenHash, input.deviceId),
        responseQuery(),
      ])
      if ([0, 1, 2].every(index => Number(results[index]?.meta?.changes) === 1)) return response(results[3]?.results?.[0])
      // A simultaneous retry can lose the insert yet prove the already-consumed credentials.
      return response(await responseQuery().first())
    } catch { return conflict() }
  }

  async function recovery(request, env, pairingId) {
    const owner = await ownerPairing(request, env, pairingId)
    if (!owner && (request.method !== 'GET' || !await authenticateTv(request, env, pairingId))) {
      return json({ error: 'Authentication failed.' }, 401)
    }
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT payload FROM companion_client_recovery WHERE pairing_id = ?').bind(pairingId).first()
      return json({ payload: row?.payload ?? null })
    }
    const input = await body(request)
    if (!validEnvelope(input?.payload)) return json({ error: 'Invalid encrypted client recovery payload (maximum 8192 bytes).' }, 400)
    const result = await env.DB.prepare(`INSERT INTO companion_client_recovery (pairing_id, payload) VALUES (?, ?)
      ON CONFLICT(pairing_id) DO NOTHING`).bind(pairingId, input.payload).run()
    return json({ ok: true, stored: Number(result.meta?.changes) === 1 })
  }

  return { links, claim, recovery }
}
