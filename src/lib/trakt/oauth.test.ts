import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTraktAuthorization, isTraktCallbackLink, parseTraktCallback, TRAKT_AUTH_TTL_MS, TRAKT_SITE_REDIRECT_URI, validTraktAuthorization } from './oauth'

beforeAll(() => { vi.stubGlobal('crypto', webcrypto) })

describe('Trakt website OAuth contract', () => {
  const state = 'a'.repeat(64)
  const link = `izumi://auth/trakt#state=${state}&code=temporary-code`

  it('creates fresh state and S256 PKCE without exposing the verifier or a secret', async () => {
    const first = await createTraktAuthorization('client-id', 'profile-a', 1000)
    const second = await createTraktAuthorization('client-id', 'profile-a', 1000)
    const url = new URL(first.url)
    expect(url.origin + url.pathname).toBe('https://auth.trakt.tv/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code', client_id: 'client-id', redirect_uri: TRAKT_SITE_REDIRECT_URI,
      state: first.pending.state, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(first.pending.verifier).digest('base64url'),
    })
    expect(first.pending.state).toMatch(/^[a-f0-9]{64}$/)
    expect(first.pending.verifier).toMatch(/^[a-f0-9]{64}$/)
    expect(first.pending.state).not.toBe(second.pending.state)
    expect(first.pending.verifier).not.toBe(second.pending.verifier)
    expect(first.url).not.toContain(first.pending.verifier)
    expect(url.searchParams.has('client_secret')).toBe(false)
  })

  it('accepts only bounded, unambiguous callbacks on the exact native endpoint', () => {
    expect(isTraktCallbackLink(link)).toBe(true)
    expect(parseTraktCallback(link)).toEqual({ state, code: 'temporary-code' })
    expect(parseTraktCallback(`izumi://auth/trakt#state=${state}&error=access_denied`)).toEqual({ state, error: 'access_denied' })
    for (const invalid of [
      link.replace('izumi:', 'https:'), link.replace('/trakt#', '/trakt/#'),
      link.replace('auth/', 'auth.evil/'), link.replace('auth/', 'user@auth/'),
      link.replace('#', '?'), `${link}&state=${state}`, `${link}&code=another`,
      `${link}&error=access_denied`, `${link}&access_token=private`,
      link.replace(state, 'short'), link.replace('temporary-code', '<script>'),
      link.replace('temporary-code', 'a'.repeat(2049)),
      `izumi://auth/trakt#state=${state}&error=untrusted-message`, 'not a URL',
    ]) expect(parseTraktCallback(invalid), invalid.slice(0, 100)).toBeNull()
  })

  it('binds a transaction to its profile, client, exact callback, and ten-minute lifetime', async () => {
    const { pending } = await createTraktAuthorization('client-id', 'profile-a', 1000)
    expect(validTraktAuthorization(pending, 'profile-a', 'client-id', 1000)).toBe(true)
    expect(validTraktAuthorization(pending, 'profile-a', 'client-id', 1000 + TRAKT_AUTH_TTL_MS - 1)).toBe(true)
    for (const [value, profile, client, now] of [
      [null, 'profile-a', 'client-id', 1000],
      [pending, 'profile-b', 'client-id', 1000],
      [pending, 'profile-a', 'other-client', 1000],
      [pending, 'profile-a', 'client-id', 999],
      [pending, 'profile-a', 'client-id', 1000 + TRAKT_AUTH_TTL_MS],
      [{ ...pending, redirectUri: 'https://evil.example' }, 'profile-a', 'client-id', 1000],
      [{ ...pending, verifier: '' }, 'profile-a', 'client-id', 1000],
    ] as const) expect(validTraktAuthorization(value, profile, client, now)).toBe(false)
  })
})
