import type { Media } from '$lib/anilist/types'

/** Small, factual taste features shared by persisted history and discovery decisions. */
export function tasteMetadata(media: Partial<Media>) {
  return {
    genres: media.genres?.slice(0, 12),
    originalLanguage: media.originalLanguage,
    countryOfOrigin: media.countryOfOrigin,
    startDate: media.startDate,
    seasonYear: media.seasonYear,
    tags: media.tags?.filter(tag => !tag.isGeneralSpoiler && !tag.isMediaSpoiler && (tag.rank ?? 100) >= 60)
      .slice(0, 8).map(({ name, rank }) => ({ name, rank })),
    studios: media.studios ? { nodes: media.studios.nodes?.slice(0, 8).map(({ id, name }) => ({ id, name })) } : undefined,
    creators: media.creators?.slice(0, 6),
    staff: media.staff ? { edges: media.staff.edges.filter(edge => /director|creator|original|screenplay/i.test(edge.role))
      .slice(0, 8).map(({ role, node }) => ({ role, node: { id: node.id, name: node.name } })) } : undefined,
  }
}
