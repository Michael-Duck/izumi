import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { castSubtitleFormat, castSubtitleTitle, type CastTrack } from './android-cast'
import type { CastTrackHints } from './android-cast'
import {
  controlTizenReceiver,
  getTizenReceiverStatus,
  hasActiveTizenReceiverCast,
  probeTizenReceiver,
  startTizenReceiverCast,
  stopTizenReceiverCast,
  subscribeTizenReceiverStatus,
  type CastSubtitleStyle,
  type TizenReceiverLoad,
} from './tizen-receiver-cast'

export type { CastSubtitleStyle } from './tizen-receiver-cast'

export interface DesktopCastDevice {
  id: string
  name: string
  model?: string
  manufacturer?: string
  address: string
  port: number
  protocol: 'googleCast' | 'dlna' | 'tizenReceiver' | 'airplay'
}

export interface DesktopCastSession {
  deviceId: string
  deviceName: string
  backend: 'googleCast' | 'dlna' | 'tizenReceiver' | 'airplay'
  /** Playback identity prevents a surviving cast from writing its clock into a newly opened item. */
  mediaId?: number | null
  episode?: number | null
  subtitles: { trackId: number; title: string; lang?: string }[]
  activeTrackIds: number[]
}

export interface DesktopCastStatus {
  state: 'playing' | 'paused' | 'buffering' | 'idle'
  positionSeconds: number
  durationSeconds?: number
  volume?: number
  muted?: boolean
  subtitleState?: 'off' | 'loading' | 'ready' | 'error'
  subtitleTitle?: string
  activeTrackIds?: number[]
  subtitleError?: string
}

/** Survives the player's auto-hiding Controls component being unmounted and remounted. */
export const desktopCastSession = writable<DesktopCastSession | null>(null)
/** Latest receiver clock. Unlike the Cast popover, this survives controls auto-hide so resume,
 * history, handoff, and the titlebar all observe one authoritative remote position. */
export const desktopCastStatus = writable<DesktopCastStatus | null>(null)

/** A cast belongs to the player item that started it. Unscoped sessions are retained for
 * compatibility with sessions created before playback identity was added. */
export function desktopCastSessionMatchesPlayback(
  session: DesktopCastSession | null,
  mediaId: number | null | undefined,
  episode: number | null | undefined,
): boolean {
  if (!session) return false
  if (session.mediaId != null && session.mediaId !== mediaId) return false
  if (session.episode != null && session.episode !== (episode ?? null)) return false
  return true
}

const PLAYING_POLL_MS = 3_000
const IDLE_POLL_MS = 6_000
let pollGeneration = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
let renderingPoll = 0
let pollFailures = 0
let stopTizenStatusSubscription: (() => void) | null = null

export interface CastSubtitleSource {
  url: string
  lang?: string
  title?: string
  headers?: Record<string, string>
}

export interface CastSourceWithSubtitles {
  url: string
  headers?: Record<string, string>
  manifest?: 'hls' | 'dash'
  subtitles?: CastSubtitleSource[]
}

export interface PreparedCastSource {
  url: string
  relayed: boolean
  subtitles: { url: string; lang?: string; title?: string; contentType: string }[]
}

export interface DesktopCastPrepareOptions {
  forceRelay?: boolean
  contentType?: string
  subtitleDelivery?: 'web' | 'samsungDlna' | 'tizenReceiver'
}

export interface DesktopCastStartInput {
  device: DesktopCastDevice
  deviceId: string
  url: string
  title?: string
  contentRating?: string
  contentType: string
  positionSeconds: number
  subtitles: PreparedCastSource['subtitles']
  activeTrackIds: number[]
  media?: TizenReceiverLoad['media']
  skipSegments?: TizenReceiverLoad['skipSegments']
  trackPreferences?: TizenReceiverLoad['trackPreferences']
  trackHints?: CastTrackHints
  subtitleStyle?: CastSubtitleStyle
  receiverPreferred?: boolean
}

type AirPlayVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void
  webkitCurrentPlaybackTargetIsWireless?: boolean
}

interface AirPlayRuntime {
  video: AirPlayVideo
  started: boolean
}

let pendingAirPlay: AirPlayRuntime | null = null
let activeAirPlay: AirPlayRuntime | null = null

function createAirPlayVideo(): AirPlayVideo | null {
  if (typeof document === 'undefined') return null
  const video = document.createElement('video') as AirPlayVideo
  if (typeof video.webkitShowPlaybackTargetPicker !== 'function') return null
  video.setAttribute('x-webkit-airplay', 'allow')
  video.setAttribute('playsinline', '')
  video.preload = 'metadata'
  video.style.display = 'none'
  return video
}

export function airPlayAvailable(): boolean {
  return createAirPlayVideo() !== null
}

function destroyAirPlay(runtime: AirPlayRuntime | null) {
  if (!runtime) return
  runtime.video.pause()
  runtime.video.removeAttribute('src')
  runtime.video.load()
  runtime.video.remove()
}

/** Must run directly inside the device-button click so WebKit retains user activation. */
export function beginAirPlaySelection(url: string, positionSeconds = 0): void {
  const video = createAirPlayVideo()
  if (!video) throw new Error('AirPlay is not available on this device.')
  destroyAirPlay(pendingAirPlay)
  pendingAirPlay = { video, started: false }
  document.body.appendChild(video)
  video.src = url
  video.muted = true
  const seek = () => {
    if (Number.isFinite(positionSeconds) && positionSeconds > 0) {
      try { video.currentTime = positionSeconds } catch { /* metadata is not ready yet */ }
    }
  }
  video.addEventListener('loadedmetadata', seek, { once: true })
  // A muted warm-up keeps the media element eligible for routing without duplicating local audio.
  void video.play().catch(() => {})
  video.webkitShowPlaybackTargetPicker?.()
}

export function cancelAirPlaySelection(): void {
  destroyAirPlay(pendingAirPlay)
  pendingAirPlay = null
}

async function waitForAirPlayRoute(video: AirPlayVideo): Promise<void> {
  if (video.webkitCurrentPlaybackTargetIsWireless) return
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (!video.webkitCurrentPlaybackTargetIsWireless) return
      clearTimeout(timeout)
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', finish)
      resolve()
    }
    const timeout = setTimeout(() => {
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', finish)
      reject(new Error('No AirPlay receiver was selected.'))
    }, 15_000)
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', finish)
  })
}

function airPlayStatus(runtime: AirPlayRuntime): DesktopCastStatus {
  const video = runtime.video
  const activeTrackIds = Array.from(video.textTracks).flatMap((track, index) => track.mode === 'showing' ? [index + 1] : [])
  return {
    state: video.ended ? 'idle' : video.paused ? 'paused' : video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ? 'buffering' : 'playing',
    positionSeconds: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    durationSeconds: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined,
    volume: video.volume,
    muted: video.muted,
    activeTrackIds,
  }
}

async function startAirPlay(request: DesktopCastStartInput): Promise<Omit<DesktopCastSession, 'subtitles' | 'activeTrackIds'>> {
  const runtime = pendingAirPlay
  if (!runtime) throw new Error('Open the AirPlay picker again and choose a receiver.')
  try {
    await waitForAirPlayRoute(runtime.video)
    if (runtime.video.src !== request.url) runtime.video.src = request.url
    runtime.video.muted = false
    for (const [index, subtitle] of request.subtitles.entries()) {
      if (!subtitle.contentType.includes('vtt')) continue
      const track = document.createElement('track')
      track.kind = 'subtitles'
      track.src = subtitle.url
      track.label = subtitle.title || subtitle.lang || `Subtitle ${index + 1}`
      if (subtitle.lang) track.srclang = subtitle.lang
      track.default = request.activeTrackIds.includes(index + 1)
      runtime.video.appendChild(track)
    }
    const seek = () => {
      if (request.positionSeconds > 0) runtime.video.currentTime = request.positionSeconds
    }
    if (runtime.video.readyState >= HTMLMediaElement.HAVE_METADATA) seek()
    else runtime.video.addEventListener('loadedmetadata', seek, { once: true })
    await runtime.video.play()
    runtime.started = true
    pendingAirPlay = null
    destroyAirPlay(activeAirPlay)
    activeAirPlay = runtime
    return { deviceId: request.device.id, deviceName: 'AirPlay', backend: 'airplay' }
  } catch (error) {
    cancelAirPlaySelection()
    throw error
  }
}

/** Match mpv's selected external track back to the source sidecar that the LAN relay can fetch. */
export function selectedCastSubtitle(
  source: CastSourceWithSubtitles,
  tracks: CastTrack[],
): CastSubtitleSource | null {
  const selected = tracks.find((track) => track.type === 'sub' && track.selected)
  if (!selected) return null
  const candidates = (source.subtitles ?? []).filter((candidate) => castSubtitleFormat(candidate.url))
  const external = selected.externalFilename?.trim()
  if (external) {
    const exact = candidates.find((candidate) => {
      if (candidate.url === external) return true
      try {
        return decodeURIComponent(new URL(candidate.url).pathname) === decodeURIComponent(new URL(external).pathname)
      } catch {
        return false
      }
    })
    if (exact) return exact
  }

  // mpv can replace a remote subtitle URL with its localhost proxy/cache filename. That transformed
  // value is not source identity, so retain the title/language fallback instead of giving up merely
  // because externalFilename was populated.
  const titled = selected.title
    ? candidates.find((candidate) => candidate.title === selected.title)
    : undefined
  if (titled) return titled
  return selected.lang
    ? candidates.find((candidate) => candidate.lang === selected.lang) ?? null
    : null
}

export async function discoverDesktopCast(waitMs = 1_800): Promise<DesktopCastDevice[]> {
  const devices = await invoke<DesktopCastDevice[]>('desktop_cast_discover', { request: { waitMs } })
  if (!airPlayAvailable()) return devices
  return [{
    id: 'airplay-system-picker',
    name: 'AirPlay…',
    model: 'Apple system picker',
    manufacturer: 'Apple',
    address: 'system',
    port: 0,
    protocol: 'airplay',
  }, ...devices]
}

export function prepareDesktopCast(
  source: CastSourceWithSubtitles,
  subtitles: CastSubtitleSource[],
  options: DesktopCastPrepareOptions = {},
): Promise<PreparedCastSource> {
  return invoke('cast_prepare_source', {
    request: {
      url: source.url,
      headers: source.headers ?? {},
      manifest: source.manifest,
      forceRelay: options.forceRelay ?? false,
      contentType: options.contentType,
      subtitleDelivery: options.subtitleDelivery ?? 'web',
      subtitles: subtitles.map((subtitle, index) => ({
        url: subtitle.url,
        lang: subtitle.lang,
        title: castSubtitleTitle(subtitle, index),
        format: castSubtitleFormat(subtitle.url),
        headers: subtitle.headers ?? {},
      })),
    },
  })
}

const samsungDevice = (device: DesktopCastDevice) =>
  device.protocol === 'tizenReceiver'
  || device.protocol === 'dlna'
    && /samsung/i.test(`${device.manufacturer ?? ''} ${device.model ?? ''} ${device.name}`)

export function desktopCastSupportsDlnaSubtitles(device: DesktopCastDevice): boolean {
  return samsungDevice(device)
}

export async function hasTizenReceiver(device: DesktopCastDevice): Promise<boolean> {
  if (!samsungDevice(device)) return false
  return probeTizenReceiver(device, 'Izumi Desktop')
}

export function desktopCastContentType(device: DesktopCastDevice, contentType: string): string {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() || contentType
  if (!samsungDevice(device)) return normalized
  switch (normalized) {
    case 'video/x-matroska':
    case 'application/x-matroska': return 'video/x-mkv'
    case 'audio/flac': return 'audio/x-flac'
    case 'audio/wav': return 'audio/x-wav'
    case 'video/mp2t': return 'video/mpeg'
    default: return normalized
  }
}

export async function startDesktopCast(
  request: DesktopCastStartInput,
): Promise<Omit<DesktopCastSession, 'subtitles' | 'activeTrackIds'>> {
  if (request.device.protocol === 'airplay') return startAirPlay(request)
  const { device, receiverPreferred, contentRating, media, skipSegments, trackPreferences, trackHints, ...nativeRequest } = request
  const receiverRequest = { ...nativeRequest, contentRating, media, skipSegments, trackPreferences, trackHints }
  if (device.protocol === 'tizenReceiver') {
    await startTizenReceiverCast(device, receiverRequest, 'Izumi Desktop')
    return { deviceId: device.id, deviceName: device.name, backend: 'tizenReceiver' }
  }
  if (receiverPreferred !== false && samsungDevice(device)) {
    try {
      await startTizenReceiverCast(device, receiverRequest, 'Izumi Desktop')
      return { deviceId: device.id, deviceName: device.name, backend: 'tizenReceiver' }
    } catch {
      // Fall through to the television's native DLNA renderer when the companion is not open.
    }
  }
  return invoke('desktop_cast_start', { request: nativeRequest })
}

export async function getDesktopCastStatus(includeRendering = true): Promise<DesktopCastStatus> {
  if (activeAirPlay) return airPlayStatus(activeAirPlay)
  if (hasActiveTizenReceiverCast()) return getTizenReceiverStatus()
  return invoke('desktop_cast_status', { includeRendering })
}

const validDuration = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** Preserve the last useful clock fields when older renderers answer GetPositionInfo with
 * NOT_IMPLEMENTED/zero, especially after STOPPED resets their position at natural EOF. */
export function reconcileDesktopCastStatus(
  previous: DesktopCastStatus | null,
  next: DesktopCastStatus,
  acceptZero = false,
): DesktopCastStatus {
  const durationSeconds = validDuration(next.durationSeconds)
    ? next.durationSeconds
    : previous?.durationSeconds
  let positionSeconds = Number.isFinite(next.positionSeconds) && next.positionSeconds >= 0
    ? next.positionSeconds
    : previous?.positionSeconds ?? 0
  if (!acceptZero && positionSeconds === 0 && (previous?.positionSeconds ?? 0) > 1) {
    positionSeconds = previous!.positionSeconds
  }
  if (validDuration(durationSeconds)) positionSeconds = Math.min(positionSeconds, durationSeconds)
  return {
    ...previous,
    ...next,
    positionSeconds,
    durationSeconds,
    volume: next.volume ?? previous?.volume,
    muted: next.muted ?? previous?.muted,
  }
}

const terminalCastError = (error: unknown) =>
  /no active cast|ended|no longer active/i.test(error instanceof Error ? error.message : String(error))

export async function refreshDesktopCastStatus(includeRendering = true): Promise<DesktopCastStatus> {
  const next = await getDesktopCastStatus(includeRendering)
  let reconciled = next
  desktopCastStatus.update((previous) => (reconciled = reconcileDesktopCastStatus(previous, next)))
  return reconciled
}

function scheduleDesktopCastPoll(generation: number, delay: number) {
  if (generation !== pollGeneration) return
  pollTimer = setTimeout(() => { void pollDesktopCastStatus(generation) }, delay)
}

async function pollDesktopCastStatus(generation: number) {
  if (generation !== pollGeneration || !get(desktopCastSession)) return
  try {
    // Position/transport are the only values needed every tick. Volume and mute change rarely and
    // cost two extra SOAP actions, so sample them on the first tick and about every 30 seconds.
    await refreshDesktopCastStatus(renderingPoll++ % 10 === 0)
    pollFailures = 0
  } catch (error) {
    if (generation !== pollGeneration) return
    pollFailures += 1
    if (terminalCastError(error) && pollFailures >= 2) {
      desktopCastSession.set(null)
      desktopCastStatus.set(null)
      return
    }
  }
  if (generation !== pollGeneration || !get(desktopCastSession)) return
  const state = get(desktopCastStatus)?.state
  const base = state === 'playing' || state === 'buffering' ? PLAYING_POLL_MS : IDLE_POLL_MS
  const backoff = pollFailures ? Math.min(4, 2 ** pollFailures) : 1
  scheduleDesktopCastPoll(generation, base * backoff)
}

export function startDesktopCastStatusPolling(seed?: DesktopCastStatus) {
  stopDesktopCastStatusPolling(false)
  if (seed) desktopCastStatus.set(seed)
  stopTizenStatusSubscription = subscribeTizenReceiverStatus((status) => {
    const session = get(desktopCastSession)
    if (!session || session.backend !== 'tizenReceiver') return
    desktopCastStatus.update((previous) => reconcileDesktopCastStatus(previous, status, true))
    if (Array.isArray(status.activeTrackIds)) {
      desktopCastSession.update((current) => current && current.backend === 'tizenReceiver'
        ? { ...current, activeTrackIds: status.activeTrackIds! }
        : current)
    }
  })
  renderingPoll = 0
  pollFailures = 0
  const generation = ++pollGeneration
  void pollDesktopCastStatus(generation)
}

export function stopDesktopCastStatusPolling(clearStatus = true) {
  pollGeneration += 1
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  stopTizenStatusSubscription?.()
  stopTizenStatusSubscription = null
  if (clearStatus) desktopCastStatus.set(null)
}

export async function controlDesktopCast(request: {
  action: 'play' | 'pause' | 'seek' | 'volume' | 'tracks' | 'status'
  positionSeconds?: number
  volume?: number
  muted?: boolean
  activeTrackIds?: number[]
}): Promise<DesktopCastStatus> {
  const previous = get(desktopCastStatus)
  const seekTarget = request.action === 'seek' && Number.isFinite(request.positionSeconds)
    ? Math.max(0, request.positionSeconds!)
    : null
  if (seekTarget != null) {
    desktopCastStatus.update((status) => status && ({ ...status, positionSeconds: seekTarget }))
  }
  try {
    let next: DesktopCastStatus
    if (activeAirPlay) {
      const video = activeAirPlay.video
      if (request.action === 'play') await video.play()
      else if (request.action === 'pause') video.pause()
      else if (request.action === 'seek' && request.positionSeconds != null) video.currentTime = Math.max(0, request.positionSeconds)
      else if (request.action === 'volume') {
        if (request.volume != null) video.volume = Math.min(1, Math.max(0, request.volume))
        if (request.muted != null) video.muted = request.muted
      } else if (request.action === 'tracks') {
        const ids = request.activeTrackIds ?? []
        Array.from(video.textTracks).forEach((track, index) => { track.mode = ids.includes(index + 1) ? 'showing' : 'disabled' })
      }
      next = airPlayStatus(activeAirPlay)
    } else next = hasActiveTizenReceiverCast()
      ? await controlTizenReceiver(request)
      : await invoke<DesktopCastStatus>('desktop_cast_control', { request })
    // Many DLNA renderers return the pre-seek clock for a short window after accepting Seek.
    // Keep the requested target immediately; the normal poller will reconcile the settled clock.
    const settled = seekTarget == null ? next : { ...next, positionSeconds: seekTarget }
    let reconciled = settled
    desktopCastStatus.update((current) => (
      reconciled = reconcileDesktopCastStatus(current, settled, seekTarget != null)
    ))
    return reconciled
  } catch (error) {
    if (seekTarget != null) desktopCastStatus.set(previous)
    throw error
  }
}

/** Route a seek only when the active cast still belongs to this player item. */
export async function seekActiveDesktopCast(
  positionSeconds: number,
  mediaId: number | null | undefined,
  episode: number | null | undefined,
): Promise<boolean> {
  if (!desktopCastSessionMatchesPlayback(get(desktopCastSession), mediaId, episode)) return false
  if (!Number.isFinite(positionSeconds)) return true
  await controlDesktopCast({ action: 'seek', positionSeconds: Math.max(0, positionSeconds) })
  return true
}

export async function stopDesktopCast(): Promise<void> {
  try {
    if (activeAirPlay) {
      destroyAirPlay(activeAirPlay)
      activeAirPlay = null
      return
    }
    cancelAirPlaySelection()
    if (hasActiveTizenReceiverCast()) {
      await stopTizenReceiverCast()
      return
    }
    return await invoke('desktop_cast_stop')
  } finally {
    stopDesktopCastStatusPolling()
  }
}

desktopCastSession.subscribe((session) => {
  if (!session) stopDesktopCastStatusPolling()
})
