import { expect, it, vi } from 'vitest'
import { downloadSubtitle, subtitleTicket } from '../src/subtitle-delivery.js'
it('delivers a signed, scoped subtitle with CORS and rejects tampering and expiry', async () => {
  const fetcher = vi.fn(async () => new Response('1\n00:00:01,000 --> 00:00:02,000\nHello'))
  const ticket = await subtitleTicket('https://subs.example/file.srt', 'pairing', 'server-key', 1000)
  const response = await downloadSubtitle(ticket, 'pairing', 'server-key', fetcher, 1001)
  expect(await response.text()).toContain('Hello')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  await expect(downloadSubtitle(ticket, 'other', 'server-key', fetcher, 1001)).rejects.toThrow()
  await expect(downloadSubtitle(ticket, 'pairing', 'other-key', fetcher, 1001)).rejects.toThrow()
  await expect(downloadSubtitle(ticket, 'pairing', 'server-key', fetcher, 1000 + 6 * 60 * 60_000)).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('rejects private redirects, HTML errors and oversized content', async () => {
  const ticket = await subtitleTicket('https://subs.example/file.srt', 'pairing', 'secret')
  await expect(downloadSubtitle(ticket, 'pairing', 'secret', async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } }))).rejects.toThrow()
  await expect(downloadSubtitle(ticket, 'pairing', 'secret', async () => new Response('<html>Not available</html>'))).rejects.toThrow()
  await expect(downloadSubtitle(ticket, 'pairing', 'secret', async () => new Response('large', { headers: { 'Content-Length': '9000000' } }))).rejects.toThrow()
})
