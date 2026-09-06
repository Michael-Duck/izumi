// Host modules for Nuvio's bundled CommonJS providers. Loaded only inside their worker.
import * as cheerio from 'cheerio'
import CryptoJS from 'crypto-js'
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios'
import { Buffer } from 'buffer/'

interface FetchResponse {
  status: number
  url: string
  headers: { entries(): IterableIterator<[string, string]> }
  text(): Promise<string>
}
export type NuvioFetch = (url: string, init?: {
  method?: string; headers?: Record<string, string>; body?: string
}) => Promise<FetchResponse>

export function createNuvioModules(fetch: NuvioFetch, scraperId = '', settings: Record<string, unknown> = {}) {
  // Use Axios' real transforms, instances, params, interceptors and error contract, with the
  // existing native HTTP bridge as its transport. Never let Axios bypass that bridge via XHR.
  const adapter: AxiosAdapter = async (config) => {
    if (config.responseType && !['json', 'text'].includes(config.responseType)) {
      throw new AxiosError('This provider requires binary HTTP responses, which the extension bridge does not support.', 'ERR_NOT_SUPPORT', config)
    }
    const url = axios.getUri(config)
    const headers = Object.fromEntries(Object.entries(config.headers.toJSON())
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)]))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const request = fetch(url, {
        method: config.method?.toUpperCase(), headers,
        body: config.data == null ? undefined : String(config.data),
      })
      const response = await (config.timeout ? Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AxiosError('Provider request timed out', 'ECONNABORTED', config)), config.timeout)
        }),
      ]) : request)
      const result: AxiosResponse = {
        data: await response.text(), status: response.status, statusText: '', config,
        headers: Object.fromEntries(response.headers.entries()),
        request: { responseURL: response.url },
      }
      if (config.validateStatus && !config.validateStatus(result.status)) {
        throw new AxiosError(`Request failed with status code ${result.status}`,
          result.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', config, result.request, result)
      }
      return result
    } finally { if (timer) clearTimeout(timer) }
  }
  const http = axios.create({ adapter })
  Object.assign(http, {
    isAxiosError: axios.isAxiosError, isCancel: axios.isCancel,
    AxiosError, CanceledError: axios.CanceledError, CancelToken: axios.CancelToken,
  })
  const modules: Record<string, unknown> = {
    'cheerio-without-node-native': cheerio,
    'react-native-cheerio': cheerio,
    cheerio,
    'crypto-js': CryptoJS,
    axios: http,
    buffer: { Buffer },
    url: { URL, URLSearchParams },
  }
  return {
    Buffer,
    globals: { Buffer, CryptoJS, SCRAPER_ID: scraperId, SCRAPER_SETTINGS: settings },
    require(name: string): unknown {
      if (Object.hasOwn(modules, name)) return modules[name]
      throw new Error(`Unsupported Nuvio provider module: ${name}`)
    },
  }
}

/** Wrap CommonJS without evaluating any provider code on the app's main thread. */
export function wrapNuvioModule(code: string): string {
  return `export default function(require, Buffer, process) {
const module = { exports: {} };
const exports = module.exports;
const global = globalThis;
${code}
;return typeof module.exports.getStreams === 'function' ? module.exports
  : typeof getStreams === 'function' ? { getStreams } : module.exports;
}`
}
