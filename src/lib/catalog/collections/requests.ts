import type { CollectionSource } from './model'

const filterNames: Record<string, string> = {
  withGenres: 'with_genres', withoutGenres: 'without_genres', voteAverageGte: 'vote_average.gte',
  voteAverageLte: 'vote_average.lte', voteCountGte: 'vote_count.gte', withOriginalLanguage: 'with_original_language',
  withOriginCountry: 'with_origin_country', withKeywords: 'with_keywords', withoutKeywords: 'without_keywords',
  withCompanies: 'with_companies', withoutCompanies: 'without_companies', withNetworks: 'with_networks',
  watchRegion: 'watch_region', withWatchProviders: 'with_watch_providers', withoutWatchProviders: 'without_watch_providers',
}

export function collectionTmdbRequest(source: CollectionSource, page = 1) {
  const sourceType = source.tmdbSourceType
  const kind: 'tv' | 'movie' = sourceType === 'NETWORK' || ['tv', 'series'].includes(source.mediaType ?? '') ? 'tv' : 'movie'
  const params: Record<string, string | number | boolean | undefined> = { language: 'en-US', page }
  const filters = source.filters ?? {}
  for (const [key, value] of Object.entries(filters)) {
    const name = filterNames[key] ?? (key === 'year' ? kind === 'movie' ? 'year' : 'first_air_date_year'
      : key === 'releaseDateGte' ? `${kind === 'movie' ? 'primary_release_date' : 'first_air_date'}.gte`
        : key === 'releaseDateLte' ? `${kind === 'movie' ? 'primary_release_date' : 'first_air_date'}.lte` : undefined)
    // Silently dropping a filter can materially change a curated (including children's) catalog.
    if (!name) throw new Error(`This collection uses an unsupported TMDB filter: ${key}.`)
    params[name] = value
  }
  const id = source.tmdbId
  if (sourceType === 'LIST') return { path: `/list/${id}`, kind, params, field: 'items' as const }
  if (sourceType === 'COLLECTION') return { path: `/collection/${id}`, kind: 'movie' as const, params, field: 'parts' as const }
  if (sourceType === 'PERSON' || sourceType === 'DIRECTOR') {
    return { path: `/person/${id}/combined_credits`, kind, params, field: sourceType === 'PERSON' ? 'cast' as const : 'crew' as const }
  }
  if (!['DISCOVER', 'COMPANY', 'NETWORK'].includes(sourceType ?? '')) throw new Error(`Unsupported TMDB source: ${sourceType ?? 'unknown'}.`)
  params.sort_by = source.sortBy && source.sortBy !== 'original' ? source.sortBy : 'popularity.desc'
  if (kind === 'tv' && params.sort_by === 'primary_release_date.desc') params.sort_by = 'first_air_date.desc'
  if (kind === 'movie' && params.sort_by === 'first_air_date.desc') params.sort_by = 'primary_release_date.desc'
  if (sourceType === 'COMPANY') params.with_companies = id
  if (sourceType === 'NETWORK') params.with_networks = id
  if (params.with_watch_providers || params.without_watch_providers) params.watch_region ||= 'US'
  if (params.with_watch_providers) params.with_watch_monetization_types = 'flatrate|free|ads|rent|buy'
  return { path: `/discover/${kind}`, kind, params, field: 'results' as const }
}
