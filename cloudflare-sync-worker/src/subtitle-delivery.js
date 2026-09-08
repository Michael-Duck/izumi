const encoder = new TextEncoder()
const LIMIT = 2 * 1024 * 1024
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const keyFor = secret => crypto.subtle.importKey('raw', encoder.encode(`izumi-subtitle-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

function publicUrl(value) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  // Reject all numeric/address aliases as well as local hostnames, including on redirects.
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !host.includes('.')
    || /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) throw new Error('Invalid subtitle address.')
  return url.toString()
}

export async function subtitleTicket(target, pairingId, secret, now = Date.now()) {
  const payload = encode(encoder.encode(JSON.stringify({ ...(typeof target === 'string' ? { url: publicUrl(target) } : { download: target }), pairingId, expires: now + 6 * 60 * 60_000 })))
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(payload))))}`
}

export async function downloadSubtitle(ticket, pairingId, secret, fetcher = fetch, now = Date.now(), resolveDownload) {
  if (typeof ticket !== 'string' || ticket.length > 16_384) throw new Error('Invalid subtitle ticket.')
  const [payload, signature, extra] = ticket.split('.')
  if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC', await keyFor(secret), decode(signature), encoder.encode(payload))) throw new Error('Invalid subtitle ticket.')
  const value = JSON.parse(new TextDecoder().decode(decode(payload)))
  if (value.pairingId !== pairingId || value.expires <= now || value.expires > now + 6 * 60 * 60_000) throw new Error('Subtitle link expired. Reopen this title.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    let url = publicUrl(value.download ? await resolveDownload(value.download) : value.url)
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'text/vtt, application/x-subrip, text/plain, */*' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        url = publicUrl(new URL(response.headers.get('Location'), url).toString())
        continue
      }
      if (!response.ok || Number(response.headers.get('Content-Length')) > LIMIT) { await response.body?.cancel(); throw new Error('The subtitle file could not be downloaded.') }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('The subtitle file is empty.')
      const chunks = []
      let size = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > LIMIT) { await reader.cancel(); throw new Error('The subtitle file is too large.') }
        chunks.push(part.value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      const charset = response.headers.get('Content-Type')?.match(/charset=([^;\s]+)/i)?.[1]?.replace(/["']/g, '')
      let decoder
      try { decoder = new TextDecoder(bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : charset || 'utf-8') } catch { decoder = new TextDecoder() }
      const text = decoder.decode(bytes)
      if (!/--> |-->\s*\d|^Dialogue\s*:|<p\b[^>]*\bbegin\s*=/im.test(text)) throw new Error('The download contains no supported subtitle cues.')
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } })
    }
    throw new Error('The subtitle address redirected too many times.')
  } finally { clearTimeout(timer) }
}
