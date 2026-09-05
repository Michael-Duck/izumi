import { describe, expect, it } from 'vitest'
import { parseTvSetupLink } from './tv-setup-link'
import { parseDeepLink } from '../deep-link-target'

describe('TV setup app links', () => {
  const fragment = '#code=ABCD2345&secret=abcdefghijklmnopqrstuv'
  it('opens custom and verified HTTPS invitations with secrets confined to fragments', () => {
    for (const root of ['izumi://tv/setup', 'https://tv-link.izumi.watch/open']) {
      expect(parseTvSetupLink(root + fragment)).toBe('/app/tv-setup' + fragment)
      expect(parseDeepLink(root + fragment)?.path).toBe('/app/tv-setup' + fragment)
    }
  })
  it('rejects malformed, credential-bearing, query-secret and unrelated links', () => {
    for (const link of ['https://evil.example/open' + fragment, 'https://tv-link.izumi.watch.evil.example/open' + fragment, 'https://user:pass@tv-link.izumi.watch/open' + fragment, 'izumi://tv/setup?secret=secret', 'izumi://tv/setup#code=bad', 'izumi://tv/setup#secret=abcdefghijklmnopqrstuv']) expect(parseTvSetupLink(link)).toBeNull()
  })
})
