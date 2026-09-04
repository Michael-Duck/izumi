import { persisted } from 'svelte-persisted-store'
import { derived, get, writable, type Readable, type Writable } from 'svelte/store'
import { validAvatar, type ProfileAvatarId } from './avatars'

export const DEFAULT_PROFILE_ID = 'default'
const PROFILES_KEY = 'izumi-profiles-v1'
const ACTIVE_PROFILE_KEY = 'izumi-active-profile-v1'
const PROFILE_KEY_PREFIX = 'izumi-profile'
const SESSION_UNLOCK_KEY = 'izumi-unlocked-profile-v1'

export type ProfileRatingLimit = 7 | 12 | 16 | 18

export interface IzumiProfile {
  id: string
  name: string
  color: string
  avatar?: ProfileAvatarId
  createdAt: number
  ratingLimit: ProfileRatingLimit
  allowAdult: boolean
  pin?: { salt: string; hash: string }
}

export interface ProfileState {
  profiles: IzumiProfile[]
  enabled?: boolean
}

export const PROFILE_COLORS = ['#ef476f', '#2a9d8f', '#457b9d', '#e9a23b', '#8b5cf6', '#d97757'] as const

const defaultProfile = (): IzumiProfile => ({
  id: DEFAULT_PROFILE_ID,
  name: 'Main profile',
  color: PROFILE_COLORS[0],
  createdAt: 0,
  ratingLimit: 18,
  allowAdult: true,
})

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage }
  catch { return undefined }
}

function storedActiveProfileId(storage = safeStorage()): string {
  const raw = storage?.getItem(ACTIVE_PROFILE_KEY)
  if (!raw) return DEFAULT_PROFILE_ID
  try {
    const value = JSON.parse(raw)
    return typeof value === 'string' && value ? value : DEFAULT_PROFILE_ID
  } catch {
    return raw || DEFAULT_PROFILE_ID
  }
}

function cleanProfile(value: unknown): IzumiProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<IzumiProfile>
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name.trim()) return null
  const ratingLimit: ProfileRatingLimit = raw.ratingLimit === 7 || raw.ratingLimit === 12 || raw.ratingLimit === 16
    ? raw.ratingLimit
    : 18
  const pin = raw.pin && typeof raw.pin.salt === 'string' && typeof raw.pin.hash === 'string'
    ? { salt: raw.pin.salt, hash: raw.pin.hash }
    : undefined
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, 32),
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : PROFILE_COLORS[0],
    avatar: validAvatar(raw.avatar),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    ratingLimit,
    allowAdult: ratingLimit === 18 && raw.allowAdult === true,
    pin,
  }
}

export function normalizeProfileState(value: unknown): ProfileState {
  const raw = value && typeof value === 'object' ? value as Partial<ProfileState> : {}
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map(cleanProfile).filter((profile): profile is IzumiProfile => !!profile)
    : []
  if (!profiles.some((profile) => profile.id === DEFAULT_PROFILE_ID)) profiles.unshift(defaultProfile())
  // Preserve households that were already deliberately configured; untouched installs stay simple.
  const customized = profiles.length > 1 || profiles.some((profile) => profile.name !== 'Main profile' || profile.pin || profile.ratingLimit !== 18 || !profile.allowAdult)
  return { profiles: profiles.slice(0, 8), enabled: raw.enabled ?? customized }
}

const normalizeState = normalizeProfileState

const storedProfiles = persisted<ProfileState>(PROFILES_KEY, { profiles: [defaultProfile()], enabled: false })
const normalizedInitial = normalizeState(get(storedProfiles))
if (JSON.stringify(normalizedInitial) !== JSON.stringify(get(storedProfiles))) storedProfiles.set(normalizedInitial)

export const profiles: Readable<IzumiProfile[]> = derived(storedProfiles, ($state) => normalizeState($state).profiles)
export const profilesEnabled = derived(storedProfiles, ($state) => normalizeState($state).enabled === true)
export const activeProfileId = persisted<string>(ACTIVE_PROFILE_KEY, storedActiveProfileId())
export const activeProfile: Readable<IzumiProfile> = derived(
  [profiles, activeProfileId],
  ([$profiles, $active]) => $profiles.find((profile) => profile.id === $active) ?? $profiles[0] ?? defaultProfile(),
)
export const profileSwitcherOpen = writable(false)
const initialUnlocked = (() => {
  try { return typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem(SESSION_UNLOCK_KEY) ?? '' }
  catch { return '' }
})()
const unlockedProfileId = writable(initialUnlocked)
export const activeProfileLocked: Readable<boolean> = derived(
  [activeProfile, unlockedProfileId],
  ([$profile, $unlocked]) => Boolean($profile.pin) && $unlocked !== $profile.id,
)

/** Create a persisted value in the active profile's storage partition. The original profile keeps
 * legacy keys so existing installs migrate without copying or losing data. Switching profiles
 * reloads the shell, allowing every module to bind to its new partition atomically. */
export function profileStorageKey(key: string, profileId = storedActiveProfileId()): string {
  return profileId === DEFAULT_PROFILE_ID ? key : `${PROFILE_KEY_PREFIX}:${profileId}:${key}`
}

export function profiledPersisted<T>(key: string, initial: T): Writable<T> {
  return persisted<T>(profileStorageKey(key), initial)
}

export function createProfile(input: Pick<IzumiProfile, 'name' | 'color' | 'ratingLimit' | 'allowAdult' | 'avatar'>): string {
  const id = `profile-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`
  storedProfiles.update((state) => {
    const current = normalizeState(state)
    if (current.profiles.length >= 8) return current
    return { ...current, enabled: true, profiles: [...current.profiles, {
      id,
      name: input.name.trim().slice(0, 32) || 'Profile',
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : PROFILE_COLORS[current.profiles.length % PROFILE_COLORS.length],
      createdAt: Date.now(),
      avatar: validAvatar(input.avatar),
      ratingLimit: input.ratingLimit,
      allowAdult: input.ratingLimit === 18 && input.allowAdult,
    }] }
  })
  return id
}

export function updateProfile(id: string, patch: Partial<Pick<IzumiProfile, 'name' | 'color' | 'ratingLimit' | 'allowAdult' | 'avatar'>>): void {
  storedProfiles.update((state) => ({
    ...state, enabled: true,
    profiles: normalizeState(state).profiles.map((profile) => {
      if (profile.id !== id) return profile
      const ratingLimit = patch.ratingLimit ?? profile.ratingLimit
      return {
        ...profile,
        avatar: validAvatar(patch.avatar ?? profile.avatar),
        name: patch.name == null ? profile.name : patch.name.trim().slice(0, 32) || profile.name,
        color: patch.color && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color : profile.color,
        ratingLimit,
        allowAdult: ratingLimit === 18 && (patch.allowAdult ?? profile.allowAdult),
      }
    }),
  }))
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const body = new TextEncoder().encode(`${salt}:${pin}`)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', body)))
}

export function validPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin)
}

export async function setProfilePin(id: string, pin: string | null): Promise<void> {
  let record: IzumiProfile['pin']
  if (pin != null) {
    if (!validPinFormat(pin)) throw new Error('Use a 4 to 6 digit PIN.')
    const salt = randomSalt()
    record = { salt, hash: await hashPin(pin, salt) }
  }
  storedProfiles.update((state) => ({
    ...state,
    profiles: normalizeState(state).profiles.map((profile) => profile.id === id ? { ...profile, pin: record } : profile),
  }))
  if (id === get(activeProfileId)) rememberUnlocked(id)
}

export async function verifyProfilePin(profile: IzumiProfile, pin: string): Promise<boolean> {
  if (!profile.pin) return true
  if (!validPinFormat(pin)) return false
  return (await hashPin(pin, profile.pin.salt)) === profile.pin.hash
}

export async function activateProfile(id: string, pin = ''): Promise<boolean> {
  const profile = get(profiles).find((candidate) => candidate.id === id)
  if (!profile || !(await verifyProfilePin(profile, pin))) return false
  safeStorage()?.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(id))
  rememberUnlocked(id)
  activeProfileId.set(id)
  profileSwitcherOpen.set(false)
  if (typeof location !== 'undefined') location.reload()
  return true
}

function rememberUnlocked(id: string): void {
  try { sessionStorage.setItem(SESSION_UNLOCK_KEY, id) } catch { /* unavailable in SSR/private mode */ }
  unlockedProfileId.set(id)
}

export async function unlockActiveProfile(pin: string): Promise<boolean> {
  const profile = get(activeProfile)
  if (!(await verifyProfilePin(profile, pin))) return false
  rememberUnlocked(profile.id)
  return true
}

export async function deleteProfile(id: string, pin = ''): Promise<boolean> {
  if (id === DEFAULT_PROFILE_ID || id === get(activeProfileId)) return false
  const profile = get(profiles).find((candidate) => candidate.id === id)
  if (!profile || !(await verifyProfilePin(profile, pin))) return false
  storedProfiles.update((state) => ({ ...state, profiles: normalizeState(state).profiles.filter((candidate) => candidate.id !== id) }))
  const storage = safeStorage()
  if (storage) {
    const prefix = `${PROFILE_KEY_PREFIX}:${id}:`
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key?.startsWith(prefix)) storage.removeItem(key)
    }
  }
  return true
}

/** Disabling never deletes a household or its data, and requires the main profile's PIN. */
export async function disableProfiles(pin = ''): Promise<boolean> {
  const main = get(profiles).find((profile) => profile.id === DEFAULT_PROFILE_ID)!
  if (!(await verifyProfilePin(main, pin))) return false
  storedProfiles.update((state) => ({ ...state, enabled: false }))
  return activateProfile(DEFAULT_PROFILE_ID, pin)
}
