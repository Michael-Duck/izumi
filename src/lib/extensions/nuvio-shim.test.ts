import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createNuvioModules, wrapNuvioModule } from './nuvio-shim'

const response = (body: string, status = 200) => ({
  status, url: 'https://example.test/final', headers: new Map([['content-type', 'application/json']]),
  text: async () => body,
})

function load(code: string, fetch = vi.fn().mockResolvedValue(response('{}'))) {
  const modules = createNuvioModules(fetch, 'example', { quality: '1080p' })
  const factory = runInNewContext(`(${wrapNuvioModule(code).replace('export default ', '')})`, { fetch, URL, console, ...modules.globals })
  return factory(modules.require, modules.Buffer, { env: {} })
}

describe('Nuvio CommonJS runtime', () => {
  it('executes a bundled provider with fetch, HTML parsing, crypto and Buffer', async () => {
    const fetch = vi.fn().mockResolvedValue(response('<a href="https://cdn.test/video.m3u8">1080p</a>'))
    const provider = load(`
      const cheerio = require('cheerio-without-node-native');
      const crypto = require('crypto-js');
      module.exports.getStreams = async (id, type, season, episode) => {
        const html = await (await fetch('https://example.test/' + [id,type,season,episode].join('/'))).text();
        const a = cheerio.load(html)('a');
        return [{ url: a.attr('href'), quality: a.text(), title: Buffer.from('aGVsbG8=', 'base64').toString(),
          checksum: crypto.MD5('test').toString() }];
      };`, fetch)
    expect(await provider.getStreams('123', 'tv', 2, 4)).toEqual([{
      url: 'https://cdn.test/video.m3u8', quality: '1080p', title: 'hello', checksum: '098f6bcd4621d373cade4e832627b4f6',
    }])
    expect(fetch).toHaveBeenCalledWith('https://example.test/123/tv/2/4')
  })

  it('supports exports aliases and top-level getStreams', async () => {
    expect(await load('exports.getStreams = async () => [1]').getStreams()).toEqual([1])
    expect(await load('function getStreams() { return [2] }').getStreams()).toEqual([2])
  })

  it('supplies scraper identity and settings during module initialization', () => {
    expect(load('const quality = SCRAPER_SETTINGS.quality; exports.getStreams = () => [SCRAPER_ID, quality, global.Buffer.from("ok").toString()]').getStreams())
      .toEqual(['example', '1080p', 'ok'])
  })

  it('bridges Axios instances, params, JSON bodies and forbidden browser headers', async () => {
    const fetch = vi.fn().mockResolvedValue(response('{"url":"https://cdn.test/movie.mp4"}'))
    const provider = load(`
      const axios = require('axios').create({ baseURL: 'https://api.test', headers: { Referer: 'https://source.test' } });
      module.exports = { getStreams: async (id) => [(await axios.post('/streams', { id }, { params: { lang: 'en' } })).data] };
    `, fetch)
    expect(await provider.getStreams('42')).toEqual([{ url: 'https://cdn.test/movie.mp4' }])
    expect(fetch).toHaveBeenCalledWith('https://api.test/streams?lang=en', expect.objectContaining({
      method: 'POST', body: '{"id":"42"}', headers: expect.objectContaining({ Referer: 'https://source.test' }),
    }))
  })

  it('exposes Axios HTTP errors and respects validateStatus', async () => {
    const fetch = vi.fn().mockResolvedValue(response('{"error":"missing"}', 404))
    const modules = createNuvioModules(fetch)
    const axios = modules.require('axios') as typeof import('axios').default
    await expect(axios.get('https://api.test')).rejects.toMatchObject({ isAxiosError: true, response: { status: 404, data: { error: 'missing' } } })
    expect((await axios.get('https://api.test', { validateStatus: () => true })).status).toBe(404)
    expect(axios.isAxiosError(new axios.AxiosError('test'))).toBe(true)
  })

  it('rejects unavailable host modules and binary transports explicitly', async () => {
    expect(() => load("require('fs')")).toThrow('Unsupported Nuvio provider module: fs')
    const fetch = vi.fn()
    const axios = createNuvioModules(fetch).require('axios') as typeof import('axios').default
    await expect(axios.get('https://api.test', { responseType: 'arraybuffer' })).rejects.toMatchObject({ code: 'ERR_NOT_SUPPORT' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
