// GENERATED from src/lib/stremio/playback-suitability.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
import type { Stream } from './parse'

/** Explicit extra markers are evidence; missing release metadata is not. */
export function isSupplementalVideo(stream: Stream, title = ''): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const identity = normalize(title)
  return [stream.behaviorHints?.filename, stream.title, stream.description, stream.name].some(value => {
    if (!value) return false
    let text = normalize(value.split('\n')[0])
    if (identity) text = text.replace(identity, ' ')
    return /\b(?:trailer|teaser|prologue|preview|sample|featurette|promo|behind the scenes|deleted scenes)\b/.test(text)
  })
}

export interface TvVideoCapabilities { hdr?: boolean; uhd?: boolean; av1?: boolean }

/** Reject declared encodes that the TV cannot decode; leave unknown codecs available. */
export function isTvVideoCompatible(stream: Stream, capabilities: TvVideoCapabilities = {}): boolean {
  const text = [stream.behaviorHints?.filename, stream.title, stream.description, stream.name].filter(Boolean).join(' ').replace(/[._]/g, ' ')
  const vision = /\b(?:dv|dovi|dolby\s*vision)\b/i.test(text)
  const hdrBase = /\bhdr(?:10|10\+)?\b/i.test(text)
  if (vision && !hdrBase) return false
  if (/\b(?:hi10p|hi10)\b/i.test(text) || /\b(?:h\s?264|x264|avc)\b/i.test(text) && /\b10[ -]?bit\b/i.test(text)) return false
  if (capabilities.hdr === false && (vision || hdrBase || /\bhlg\b/i.test(text))) return false
  if (capabilities.uhd === false && /\b(?:2160p?|4k|uhd)\b/i.test(text)) return false
  if (capabilities.av1 === false && /\bav1\b/i.test(text)) return false
  return true
}
