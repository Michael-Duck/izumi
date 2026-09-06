import { describe, it, expect } from 'vitest'
import { cloudToMedia, mediaToCloud, cloudEpisode, localEpisode, cloudMatchesMedia } from './media'
import { mapStremioMeta } from '$lib/catalog/providers/stremio'
import type { Media } from '$lib/anilist/types'
const series = mapStremioMeta({ id: 'tt0944947', name: 'Series', type: 'series', videos: [{ id: 'tt0944947:1:1', season: 1, episode: 1 }, { id: 'tt0944947:1:2', season: 1, episode: 2 }, { id: 'tt0944947:2:1', season: 2, episode: 1 }] }, 'https://metadata.test')!
describe('Nuvio media compatibility', () => {
  it('round-trips season two through izumi sequential numbering', () => {
    expect(cloudEpisode(series, { content_id: 'tt0944947', content_type: 'series', season: 2, episode: 1 })).toBe(3)
    expect(localEpisode(series, 3)).toEqual({ season: 2, episode: 1, video_id: 'tt0944947:2:1' })
  })
  it('does not guess episode coordinates or cross-catalog IDs for anime', () => {
    const anime: Media = { id: 123, title: { romaji: 'Anime' }, format: 'TV' }
    expect(mediaToCloud(anime)).toBeNull()
    expect(localEpisode(anime, 5)).toBeNull()
    expect(cloudEpisode({ ...series, videos: [] }, { content_id: 'tt0944947', content_type: 'series', season: 1, episode: 1 })).toBeNull()
  })
  it('preserves native IMDb identities and excludes source configuration credentials', () => {
    const row = mediaToCloud(series)!
    expect(row).toMatchObject({ content_id: 'tt0944947', content_type: 'series', name: 'Series' })
    expect(JSON.stringify(row)).not.toContain('metadata.test')
  })
  it('uses typed TMDB IDs and matches alternate external IDs', () => {
    const media = cloudToMedia({ content_id: 'tmdb:550', content_type: 'movie', name: 'Film' }, [])!
    expect(media.catalog).toEqual({ provider: 'tmdb', type: 'movie', id: '550' })
    media.externalIds = { tmdb: 550, imdb: 'tt0137523' }
    expect(cloudMatchesMedia({ content_id: 'tmdb:550', content_type: 'movie' }, media)).toBe(true)
    expect(cloudMatchesMedia({ content_id: 'tt0137523', content_type: 'movie' }, media)).toBe(true)
    expect(cloudMatchesMedia({ content_id: 'tmdb:550', content_type: 'series' }, media)).toBe(false)
  })
  it('does not install or use a cloud-provided source without local installation', () => {
    const row = { content_id: 'custom:1', content_type: 'movie' as const, addon_base_url: 'https://metadata.test', name: 'Film' }
    expect(cloudToMedia(row, [])).toBeNull()
    expect(cloudToMedia(row, ['https://metadata.test'])?.catalog?.provider).toBe('stremio')
  })
  it('filters unsafe artwork and keeps movies separate from sparse episode progress', () => {
    const movie = cloudToMedia({ content_id: 'tmdb:550', content_type: 'movie', poster: 'javascript:alert(1)' }, [])!
    expect(movie.coverImage?.large).toBeUndefined()
    expect(localEpisode(movie, 1)).toEqual({ video_id: 'tmdb:550' })
    expect(cloudEpisode(movie, { content_id: 'tmdb:550', content_type: 'movie' })).toBe(1)
  })
})
