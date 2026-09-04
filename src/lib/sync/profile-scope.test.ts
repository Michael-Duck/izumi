import { describe, expect, it } from 'vitest'
import { watchCategory, watchPayloadForProfile } from './profile-scope'
import { mergeProfileStates, normalizeProfileState } from '$lib/profiles/store'

const makeProfile = (id: string, updatedAt: number, name = id) => ({ id, name, color: '#457b9d', avatar: 'cat', createdAt: 1, updatedAt, ratingLimit: 12, allowAdult: false })
describe('household sync isolation', () => {
  it('retains the legacy main record and gives every other profile a separate slot', () => {
    expect(watchCategory('default')).toBe('watch')
    expect(watchCategory('profile-one')).toBe('watch-profile-one')
    expect(watchCategory('profile-two')).not.toBe(watchCategory('profile-one'))
    expect(() => watchCategory('../default')).toThrow()
  })
  it('never imports unlabelled legacy or another profile’s data into a child', () => {
    const legacy = { app: 'izumi', kind: 'watch-history', version: 1, history: {}, positions: {} }
    expect(watchPayloadForProfile(JSON.stringify(legacy), 'default')).toBe(true)
    expect(watchPayloadForProfile(JSON.stringify(legacy), 'child')).toBe(false)
    expect(watchPayloadForProfile(JSON.stringify({ ...legacy, profileId: 'child' }), 'default')).toBe(false)
    expect(watchPayloadForProfile(JSON.stringify({ ...legacy, profileId: 'child' }), 'child')).toBe(true)
  })
  it('merges concurrent changes to different people without replacing the household', () => {
    const left = { profiles: [makeProfile('alex', 20, 'Alex'), makeProfile('mina', 10)], enabled: true, modeUpdatedAt: 20 }
    const right = { profiles: [makeProfile('alex', 10), makeProfile('mina', 30, 'Mina')], enabled: true, modeUpdatedAt: 20 }
    const merged = mergeProfileStates(left, right)
    expect(merged.profiles.find((p) => p.id === 'alex')?.name).toBe('Alex')
    expect(merged.profiles.find((p) => p.id === 'mina')?.name).toBe('Mina')
    expect(mergeProfileStates(right, left)).toEqual(merged)
  })
  it('does not resurrect deletions from offline devices and propagates opting out', () => {
    const old = { profiles: [makeProfile('mina', 10)], enabled: true, modeUpdatedAt: 10 }
    const deleted = { profiles: [], deleted: { mina: 30 }, enabled: false, modeUpdatedAt: 30 }
    const merged = mergeProfileStates(old, deleted)
    expect(merged.enabled).toBe(false)
    expect(merged.profiles.map((p) => p.id)).toEqual(['default'])
    expect(mergeProfileStates(merged, old)).toEqual(merged)
  })
  it('does not accept credentials or device session state as household fields', () => {
    const state = normalizeProfileState({ profiles: [{ ...makeProfile('alex', 1), token: 'secret' }], activeProfileId: 'alex', unlocked: true, traktClientSecret: 'secret' })
    expect(JSON.stringify(state)).not.toContain('secret')
    expect(state).not.toHaveProperty('activeProfileId')
  })
})
