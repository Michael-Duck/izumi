import { readonly, writable } from 'svelte/store'

export const COMPANION_RESTORE_STORAGE_KEY = 'companion-client-restore-v1'

/** Read synchronously before shell timers start. No dependency on the restore service or clients. */
function readPending(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(COMPANION_RESTORE_STORAGE_KEY)
    if (!raw) return false
    const session = JSON.parse(raw)
    return session?.v !== 1 || session.stage !== 'linked' || session.recoverySeedPending === true
  } catch { return true }
}

const pending = writable(readPending())
export const companionRestorePending = readonly(pending)

/** The service clears this only after its finished journal has been written successfully. */
export function setCompanionRestorePending(value: boolean): void {
  pending.set(value)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === COMPANION_RESTORE_STORAGE_KEY || event.key === null) pending.set(readPending())
  })
}
