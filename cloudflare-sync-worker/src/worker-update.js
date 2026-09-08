const STATE_KEY = 'worker_update_v1'
export const UPDATE_MANIFEST = 'https://github.com/nickEatsBread/izumi/releases/latest/download/worker-update.json'
const CHECK_INTERVAL = 5 * 60_000
const BUILD_INTERVAL = 6 * 60 * 60_000
const LEASE = 60_000

export function newerVersion(candidate, installed) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate || '') || !/^\d+\.\d+\.\d+$/.test(installed || '')) return false
  const a = candidate.split('.').map(Number), b = installed.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

export function validDeployHook(value) {
  return typeof value === 'string' && /^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[a-zA-Z0-9_-]{16,128}$/.test(value)
}

async function readState(env) {
  const row = await env.DB.prepare('SELECT value FROM metadata WHERE key = ?').bind(STATE_KEY).first()
  return row ? { raw: row.value, value: JSON.parse(row.value) } : { raw: null, value: {} }
}

function publicStatus(env, version, state, now) {
  const configured = validDeployHook(env.WORKER_DEPLOY_HOOK)
  const available = newerVersion(state.latestVersion, version)
  const pending = available && !!state.triggeredAt && now - state.triggeredAt < BUILD_INTERVAL
  const error = state.triggeredAt && state.latestVersion && !available ? '' : state.error || ''
  return {
    version, configured, automatic: configured && env.WORKER_AUTO_UPDATE !== 'false',
    phase: !configured ? 'setup-required' : state.leaseUntil > now ? 'checking' : error ? 'error'
      : pending && now - state.triggeredAt < 30 * 60_000 ? 'queued'
      : pending ? 'delayed' : available ? 'available'
      : state.latestVersion ? 'current' : 'unchecked',
    latestVersion: state.latestVersion || '', checkedAt: state.checkedAt || 0,
    retryAt: pending ? state.triggeredAt + BUILD_INTERVAL : 0,
    error,
  }
}

export async function workerUpdateStatus(env, version, now = Date.now()) {
  return publicStatus(env, version, (await readState(env)).value, now)
}

async function fetchJson(fetcher, url, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error('Update service unavailable.')
    const text = await response.text()
    if (text.length > 16_384) throw new Error('Invalid update response.')
    return JSON.parse(text)
  } finally { clearTimeout(timeout) }
}

/** A D1 compare-and-swap prevents concurrent TVs and cron invocations from starting duplicate builds. */
export async function runWorkerUpdate(env, version, { automatic = false, fetcher = fetch, now = Date.now() } = {}) {
  let stored = await readState(env)
  if (!validDeployHook(env.WORKER_DEPLOY_HOOK) || (automatic && env.WORKER_AUTO_UPDATE === 'false')) {
    return publicStatus(env, version, stored.value, now)
  }
  if (stored.raw === null) {
    await env.DB.prepare('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)').bind(STATE_KEY, '{}').run()
    stored = await readState(env)
  }
  const previous = stored.value
  if (previous.leaseUntil > now || now - (previous.checkedAt || 0) < CHECK_INTERVAL
    || (newerVersion(previous.latestVersion, version) && now - (previous.triggeredAt || 0) < BUILD_INTERVAL)) {
    return publicStatus(env, version, previous, now)
  }
  let locked = JSON.stringify({ ...previous, leaseUntil: now + LEASE })
  const acquired = await env.DB.prepare('UPDATE metadata SET value = ? WHERE key = ? AND value = ?')
    .bind(locked, STATE_KEY, stored.raw).run()
  if (!acquired.meta?.changes) return workerUpdateStatus(env, version, now)
  const next = { ...previous, leaseUntil: 0, checkedAt: now, error: '' }
  try {
    const manifest = await fetchJson(fetcher, UPDATE_MANIFEST, { headers: { Accept: 'application/json' } })
    if (manifest.schema !== 1 || !/^v\d+\.\d+\.\d+$/.test(manifest.tag || '')
      || !/^\d+\.\d+\.\d+$/.test(manifest.version || '') || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')) {
      throw new Error('Invalid release manifest.')
    }
    next.latestVersion = manifest.version
    if (newerVersion(manifest.version, version)) {
      // Record the attempt before sending: even an ambiguous timeout must not start a build storm.
      next.triggeredAt = now
      const attempting = JSON.stringify({ ...next, leaseUntil: now + LEASE })
      const saved = await env.DB.prepare('UPDATE metadata SET value = ? WHERE key = ? AND value = ?')
        .bind(attempting, STATE_KEY, locked).run()
      if (!saved.meta?.changes) return workerUpdateStatus(env, version, now)
      locked = attempting
      const result = await fetchJson(fetcher, env.WORKER_DEPLOY_HOOK, { method: 'POST', redirect: 'error' })
      if (result.success !== true || typeof result.result?.build_uuid !== 'string') throw new Error('Build was not accepted.')
    } else next.triggeredAt = 0
  } catch {
    // Neither provider responses nor transport errors may echo the private deployment credential.
    next.error = 'The update could not be confirmed. Check Cloudflare Builds; automatic checks will retry.'
  }
  await env.DB.prepare('UPDATE metadata SET value = ? WHERE key = ? AND value = ?')
    .bind(JSON.stringify(next), STATE_KEY, locked).run()
  return publicStatus(env, version, next, now)
}
