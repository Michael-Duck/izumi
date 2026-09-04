// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({ trackerHttpFetch: vi.fn() }))
vi.mock('$lib/trackers/tracker-http', () => ({ trackerHttpFetch: mocks.trackerHttpFetch }))

import {
  traktClientId,
  traktClientSecret,
  traktRedirectUri,
  traktRefreshToken,
  traktToken,
  traktTokenExpiry,
} from './config'
import { resetTraktClientForTests, traktFetch } from './client'

describe('Trakt API client', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.trackerHttpFetch.mockReset()
    resetTraktClientForTests()
    traktClientId.set('client-id')
    traktClientSecret.set('client-secret')
    traktRedirectUri.set('izumi://trakt')
    traktToken.set('access-old')
    traktRefreshToken.set('refresh-old')
    traktTokenExpiry.set(Date.now() + 60 * 60_000)
  })

  it('sends the current Trakt v2 authentication headers', async () => {
    mocks.trackerHttpFetch.mockResolvedValue(new Response('{}'))
    await traktFetch('/users/settings')
    const [url, init, service] = mocks.trackerHttpFetch.mock.calls[0]
    expect(url).toBe('https://api.trakt.tv/users/settings')
    expect(service).toBe('Trakt')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer access-old',
      'trakt-api-key': 'client-id',
      'trakt-api-version': '2',
    })
  })

  it('refreshes an expired token and persists Trakt’s single-use replacement refresh token', async () => {
    traktTokenExpiry.set(Date.now() - 1)
    mocks.trackerHttpFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/token')) return new Response(JSON.stringify({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
        expires_in: 604800,
        created_at: Math.floor(Date.now() / 1000),
      }))
      return new Response('{}')
    })

    await traktFetch('/sync/last_activities')

    const refreshInit = mocks.trackerHttpFetch.mock.calls[0][1]
    expect(JSON.parse(refreshInit.body)).toEqual({
      refresh_token: 'refresh-old',
      client_id: 'client-id',
      client_secret: 'client-secret',
      redirect_uri: 'izumi://trakt',
      grant_type: 'refresh_token',
    })
    expect(get(traktToken)).toBe('access-new')
    expect(get(traktRefreshToken)).toBe('refresh-new')
    expect(mocks.trackerHttpFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer access-new')
  })
})
