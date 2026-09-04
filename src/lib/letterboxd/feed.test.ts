// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ trackerHttpFetch: vi.fn() }))
vi.mock('$lib/trackers/tracker-http', () => ({ trackerHttpFetch: mocks.trackerHttpFetch }))

import { letterboxdFeedCache } from './config'
import { fetchLetterboxdFeed, letterboxdFeedUrl, parseLetterboxdFeed, validLetterboxdUsername } from './feed'

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">
  <channel>
    <item>
      <title>Perfect Days, 2023 - ★★★★½</title>
      <link>https://letterboxd.com/mira/film/perfect-days-2023/</link>
      <guid>letterboxd-review-42</guid>
      <pubDate>Fri, 4 Sep 2026 10:00:00 +0100</pubDate>
      <letterboxd:watchedDate>2026-09-03</letterboxd:watchedDate>
      <letterboxd:rewatch>Yes</letterboxd:rewatch>
      <letterboxd:filmTitle>Perfect Days</letterboxd:filmTitle>
      <letterboxd:filmYear>2023</letterboxd:filmYear>
      <letterboxd:memberRating>4.5</letterboxd:memberRating>
      <letterboxd:memberLike>Yes</letterboxd:memberLike>
      <tmdb:movieId>976893</tmdb:movieId>
      <description><![CDATA[<p><img src="https://a.ltrbxd.com/perfect-days.jpg"/></p><p>Quietly wonderful.</p>]]></description>
    </item>
    <item><title>A list, not a diary entry</title><link>https://letterboxd.com/mira/list/a-list/</link></item>
  </channel>
</rss>`

describe('Letterboxd public RSS', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.trackerHttpFetch.mockReset()
    letterboxdFeedCache.set([])
  })

  it('validates and constructs only official profile feed URLs', () => {
    expect(validLetterboxdUsername('mira_92')).toBe(true)
    expect(validLetterboxdUsername('../admin')).toBe(false)
    expect(letterboxdFeedUrl('mira_92')).toBe('https://letterboxd.com/mira_92/rss/')
    expect(() => letterboxdFeedUrl('bad/name')).toThrow('valid Letterboxd username')
  })

  it('parses film entries, exact TMDB identity, rating, artwork, and review text', () => {
    const entries = parseLetterboxdFeed(RSS)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'letterboxd-review-42',
      watchedDate: '2026-09-03',
      rating: 4.5,
      liked: true,
      rewatch: true,
      review: 'Quietly wonderful.',
    })
    expect(entries[0].media.catalog).toEqual({ provider: 'tmdb', type: 'movie', id: '976893' })
    expect(entries[0].media.coverImage?.large).toBe('https://a.ltrbxd.com/perfect-days.jpg')
  })

  it('fetches through the native client and saves an offline cache', async () => {
    mocks.trackerHttpFetch.mockResolvedValue(new Response(RSS))
    const entries = await fetchLetterboxdFeed('mira')
    expect(entries).toHaveLength(1)
    expect(mocks.trackerHttpFetch).toHaveBeenCalledWith('https://letterboxd.com/mira/rss/', { signal: undefined }, 'Letterboxd')
  })
})
