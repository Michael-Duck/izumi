import { describe, expect, it } from 'vitest'
import { mapTmdbPersonProfile } from './tmdb'

describe('TMDB person profiles', () => {
  it('maps biography, identity and mixed filmography without duplicate credits', () => {
    const profile = mapTmdbPersonProfile({
      id: 287,
      name: 'Brad Pitt',
      known_for_department: 'Acting',
      birthday: '1963-12-18',
      gender: 2,
      profile_path: '/portrait.jpg',
      combined_credits: {
        cast: [
          { id: 1, media_type: 'movie', title: 'Example', popularity: 10 },
          { id: 1, media_type: 'movie', title: 'Example', popularity: 9 },
          { id: 2, media_type: 'tv', name: 'Series', popularity: 8 },
        ],
      },
    })
    expect(profile).toMatchObject({ id: 287, name: 'Brad Pitt', knownFor: 'Acting', gender: 'Man' })
    expect(profile?.image).toBe('https://image.tmdb.org/t/p/h632/portrait.jpg')
    expect(profile?.cast.map((media) => media.catalog?.type)).toEqual(['movie', 'series'])
  })

  it('rejects malformed people instead of rendering anonymous profiles', () => {
    expect(mapTmdbPersonProfile({ id: 0, name: '' })).toBeNull()
  })
})
