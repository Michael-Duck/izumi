import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

import {
  anilistDegraded,
  anilistDegradedBannerVisible,
  clearAniListDegraded,
  dismissAniListDegradedBanner,
  markAniListDegraded,
} from './degraded'

// The degraded strip is dismissible WITHOUT touching the fallback machinery: dismissal is keyed to
// the degradation episode (`since`), so the same outage stays hidden but a NEW outage re-lights it.
describe('anilist degraded banner dismissal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    clearAniListDegraded()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the banner only while the catalog is degraded', () => {
    expect(get(anilistDegradedBannerVisible)).toBe(false)
    markAniListDegraded('boom')
    expect(get(anilistDegradedBannerVisible)).toBe(true)
    clearAniListDegraded()
    expect(get(anilistDegradedBannerVisible)).toBe(false)
  })

  it('hides the banner for the current episode after dismissal without clearing the state', () => {
    markAniListDegraded('boom')
    dismissAniListDegradedBanner()
    expect(get(anilistDegradedBannerVisible)).toBe(false)
    // The fallback probe state must be untouched by a display-only dismissal.
    expect(get(anilistDegraded)?.error).toBe('boom')
  })

  it('re-shows the banner when a new outage begins', () => {
    markAniListDegraded('first outage')
    dismissAniListDegradedBanner()
    expect(get(anilistDegradedBannerVisible)).toBe(false)
    // Recovery resets `since` on the next degradation, which reads as a new episode.
    clearAniListDegraded()
    vi.setSystemTime(Date.now() + 5_000)
    markAniListDegraded('second outage')
    expect(get(anilistDegradedBannerVisible)).toBe(true)
  })

  it('keeps hiding the banner across repeated reports of the same error', () => {
    markAniListDegraded('boom')
    dismissAniListDegradedBanner()
    markAniListDegraded('boom')
    expect(get(anilistDegradedBannerVisible)).toBe(false)
  })
})
