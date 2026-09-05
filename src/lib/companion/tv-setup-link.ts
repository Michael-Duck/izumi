const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/
const SECRET = /^[A-Za-z0-9_-]{22}$/

/** Preserve invitation secrets in fragments, never query strings or server logs. */
export function parseTvSetupLink(raw: string): string | null {
  try {
    const url = new URL(raw)
    const custom = url.protocol === 'izumi:' && url.hostname === 'tv' && url.pathname === '/setup'
    const web = url.protocol === 'https:' && ['tv-link.izumi.watch', 'tv-setup.izumi.watch'].includes(url.hostname) && ['/', '/open'].includes(url.pathname)
    if ((!custom && !web) || url.username || url.password || url.port || url.search) return null
    const fragment = new URLSearchParams(url.hash.slice(1))
    const code = fragment.get('code') || ''
    const secret = fragment.get('secret') || ''
    if ((code && !CODE.test(code)) || (secret && (!code || !SECRET.test(secret)))) return null
    const cleaned = new URLSearchParams()
    if (code) cleaned.set('code', code)
    if (secret) cleaned.set('secret', secret)
    return `/app/tv-setup${cleaned.size ? `#${cleaned}` : ''}`
  } catch { return null }
}
