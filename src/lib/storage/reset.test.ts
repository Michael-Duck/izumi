import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { clearBrowserData, runReset } from '../../../static/reset-local-data.js'

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function scope() {
  return {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    indexedDB: new IDBFactory(),
    document: { cookie: '' },
    navigator: {} as Pick<Navigator, 'serviceWorker'>,
    location: { replace: vi.fn() },
  }
}

function seedDatabase(factory: IDBFactory, name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('private-data').put('history or credentials', 'saved')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

describe('local factory reset', () => {
  it('does not reset when the standalone page is opened without confirmation', () => {
    const browser = scope()
    const run = vi.fn()
    const elements = {
      status: { textContent: '' },
      retry: { hidden: true, addEventListener: vi.fn() },
      back: { hidden: true },
    }
    const html = readFileSync(new URL('../../../static/reset.html', import.meta.url), 'utf8')
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)![1]
      .replace(/import \{ runReset \} from '[^']+'/, '')
    new Function('window', 'document', 'sessionStorage', 'runReset', script)(
      browser,
      { getElementById: (id: keyof typeof elements) => elements[id] },
      browser.sessionStorage,
      run,
    )
    expect(run).not.toHaveBeenCalled()
    expect(elements.status.textContent).toBe('Start a reset from Settings → About.')
    expect(elements.back.hidden).toBe(false)
  })

  it('deletes all profiles, legacy keys, databases and caches before returning to defaults', async () => {
    const browser = scope()
    for (const key of ['anilist-token', 'izumi-profile:inactive:local-history', 'unknown-legacy-setting']) browser.localStorage.setItem(key, 'private')
    browser.sessionStorage.setItem('izumi-reset-requested', 'true')
    browser.sessionStorage.setItem('diagnostics', 'private')
    for (const name of ['izumi-library-v1', 'keyval-store', 'future-cache']) (await seedDatabase(browser.indexedDB, name)).close()
    const unregister = vi.fn().mockResolvedValue(true)
    browser.navigator = { serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) } as unknown as ServiceWorkerContainer }
    const removeCache = vi.fn().mockResolvedValue(true)
    const caches = { keys: vi.fn().mockResolvedValue(['metadata', 'images']), delete: removeCache } as unknown as CacheStorage
    await runReset({ ...browser, caches })
    expect(browser.localStorage.length).toBe(0)
    expect(browser.sessionStorage.length).toBe(0)
    expect(await browser.indexedDB.databases()).toEqual([])
    expect(unregister).toHaveBeenCalledOnce()
    expect(removeCache.mock.calls).toEqual([['metadata'], ['images']])
    expect(browser.location.replace).toHaveBeenCalledWith('/')
  })

  it('clears the known databases on older WebViews without database enumeration', async () => {
    const browser = scope()
    for (const name of ['izumi-library-v1', 'keyval-store']) (await seedDatabase(browser.indexedDB, name)).close()
    const databases = browser.indexedDB.databases.bind(browser.indexedDB)
    Object.defineProperty(browser.indexedDB, 'databases', { value: undefined })
    await clearBrowserData(browser)
    expect(await databases()).toEqual([])
  })

  it('reports a blocked database without navigating away, and allows a retry', async () => {
    const browser = scope()
    const otherWindow = await seedDatabase(browser.indexedDB, 'izumi-library-v1')
    await expect(runReset(browser)).rejects.toThrow('Close other izumi windows or tabs')
    expect(browser.location.replace).not.toHaveBeenCalled()
    otherWindow.close()
    await runReset(browser)
    expect(await browser.indexedDB.databases()).toEqual([])
    expect(browser.location.replace).toHaveBeenCalledOnce()
  })

  it('uses the native full reset without racing browser storage against live native writers', async () => {
    const browser = scope()
    browser.localStorage.setItem('credential', 'saved')
    const invoke = vi.fn().mockResolvedValue(undefined)
    await runReset({ ...browser, __TAURI__: { core: { invoke } } })
    expect(invoke).toHaveBeenCalledExactlyOnceWith('reset_local_data')
    expect(browser.localStorage.getItem('credential')).toBe('saved')
    expect(browser.location.replace).not.toHaveBeenCalled()
  })

  it('preserves browser data and reports a failed native reset', async () => {
    const browser = scope()
    browser.localStorage.setItem('credential', 'saved')
    const invoke = vi.fn().mockRejectedValue(new Error('Permission denied'))
    await expect(runReset({ ...browser, __TAURI__: { core: { invoke } } })).rejects.toThrow('Permission denied')
    expect(browser.localStorage.getItem('credential')).toBe('saved')
    expect(browser.location.replace).not.toHaveBeenCalled()
  })
})
