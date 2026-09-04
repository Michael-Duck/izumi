import { describe, expect, it } from 'vitest'
import { PROFILE_AVATARS, profileAvatarUrl, validAvatar } from './avatars'

describe('bundled profile avatars', () => {
  it('provides distinct portraits without remote requests', () => {
    const portraits = PROFILE_AVATARS.map((id) => profileAvatarUrl(id, '#2a9d8f'))
    expect(new Set(portraits).size).toBe(PROFILE_AVATARS.length)
    for (const portrait of portraits) expect(portrait).toMatch(/^data:image\/svg\+xml,/)
  })
  it('falls back safely for unknown avatars and rejects SVG injection through colours', () => {
    expect(validAvatar('unknown')).toBe('fox')
    const svg = decodeURIComponent(profileAvatarUrl('cat', '"><script>alert(1)</script>'))
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('#457b9d')
  })
})
