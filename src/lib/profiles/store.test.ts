import { describe, expect, it } from 'vitest'
import { contentRatingAge, profileAllowsMedia } from './content'
import { DEFAULT_PROFILE_ID, profileStorageKey, normalizeProfileState, type IzumiProfile } from './store'

const child: IzumiProfile = {
  id: 'child', name: 'Mina', color: '#457b9d', createdAt: 1, ratingLimit: 12, allowAdult: false,
}

describe('profile storage and parental policy', () => {
  it('leaves untouched installs opted out but preserves configured households', () => {
    expect(normalizeProfileState({}).enabled).toBe(false)
    expect(normalizeProfileState({ profiles: [child] }).enabled).toBe(true)
    expect(normalizeProfileState({ profiles: [child], enabled: false }).enabled).toBe(false)
  })
  it('keeps the original profile on legacy keys and partitions additional profiles', () => {
    expect(profileStorageKey('local-history', DEFAULT_PROFILE_ID)).toBe('local-history')
    expect(profileStorageKey('local-history', 'child')).toBe('izumi-profile:child:local-history')
  })

  it('normalizes common cinema, television and anime content ratings', () => {
    expect(contentRatingAge('PG-13')).toBe(12)
    expect(contentRatingAge('TV-MA')).toBe(18)
    expect(contentRatingAge('R - 17+ (violence & profanity)')).toBe(16)
    expect(contentRatingAge('TV-Y7')).toBe(7)
  })

  it('blocks adult and over-limit media without hiding unrated family content', () => {
    expect(profileAllowsMedia({ isAdult: true }, child)).toBe(false)
    expect(profileAllowsMedia({ contentRating: 'TV-MA' }, child)).toBe(false)
    expect(profileAllowsMedia({ contentRating: 'PG' }, child)).toBe(true)
    expect(profileAllowsMedia({}, child)).toBe(true)
  })
})
