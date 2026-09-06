// This runs in a standalone document: importing the app would reopen databases and restart sync.
// Keep the known names for older WebViews without indexedDB.databases().
const DATABASES = ['izumi-library-v1', 'keyval-store']

/** @typedef {{ localStorage: Storage, sessionStorage: Storage, navigator: Pick<Navigator, 'serviceWorker'>, indexedDB?: IDBFactory, caches?: CacheStorage, document: Pick<Document, 'cookie'>, location: Pick<Location, 'replace'>, __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } } }} ResetScope */

/** @param {ResetScope} scope */
export async function clearBrowserData(scope) {
  if (scope.navigator.serviceWorker) {
    const registrations = await scope.navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map(registration => registration.unregister()))
  }
  if (scope.caches) {
    const caches = scope.caches
    const keys = await caches.keys()
    await Promise.all(keys.map(key => caches.delete(key)))
  }
  if (scope.indexedDB) {
    const names = new Set(DATABASES)
    if (typeof scope.indexedDB.databases === 'function') {
      for (const database of await scope.indexedDB.databases()) {
        if (database.name) names.add(database.name)
      }
    }
    const databaseFactory = scope.indexedDB
    await Promise.all([...names].map(name => /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
      const request = databaseFactory.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error(`Could not remove ${name}.`))
      request.onblocked = () => reject(new Error('Close other izumi windows or tabs, then retry the reset.'))
    }))))
  }
  for (const cookie of scope.document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim()
    if (name) scope.document.cookie = `${name}=; Max-Age=0; path=/`
  }
  // Clear every key, including inactive profiles, legacy keys and saved account credentials.
  scope.localStorage.clear()
  scope.sessionStorage.clear()
}

/** @param {ResetScope} scope */
export async function runReset(scope) {
  if (scope.__TAURI__) {
    // Native reset also removes HttpOnly/third-party cookies, downloads and extension files.
    // Do not remove browser state first: a failed native reset can then be retried intact.
    await scope.__TAURI__.core.invoke('reset_local_data')
  } else {
    await clearBrowserData(scope)
    scope.location.replace('/')
  }
}
