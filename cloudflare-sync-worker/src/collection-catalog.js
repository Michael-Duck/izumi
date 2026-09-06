import { parseCollectionImport } from '../../src/lib/catalog/collections/model.ts'
import { collectionTmdbRequest } from '../../src/lib/catalog/collections/requests.ts'
import { catalogInternals as catalog } from './catalog.js'
import { normalizeAddonBase } from './resolver.js'

export function normalizeCollections(value) {
  return Array.isArray(value) && value.length ? parseCollectionImport(JSON.stringify(value)).collections : []
}

export function collectionOptions(collections, prefix = 'local') {
  return collections.map(collection => ({ screen: `${prefix}-${catalog.fnv(collection.id)}`, label: collection.title,
    cover: collection.backdropImageUrl,
    children: collection.folders.map(folder => ({ screen: `${prefix}-${catalog.fnv(`${collection.id}:${folder.id}`)}`, label: folder.title,
      cover: folder.coverImageUrl, emoji: folder.coverEmoji, shape: folder.tileShape,
      description: `${folder.sources.length} source${folder.sources.length === 1 ? '' : 's'}` })) }))
}

function endpoint(base, path) {
  const url = new URL(normalizeAddonBase(base))
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`
  return url.href
}

export async function collectionSnapshot(profile, collections, screen, prefix, page = 1, offsets = []) {
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('Invalid collection page.')
  if (!Array.isArray(offsets) || offsets.length > 8 || offsets.some(value => !Number.isInteger(value) || value < 0 || value > 100_000)) throw new Error('Invalid collection offsets.')
  const match = collections.flatMap(collection => collection.folders.map(folder => ({ collection, folder })))
    .find(({ collection, folder }) => `${prefix}-${catalog.fnv(`${collection.id}:${folder.id}`)}` === screen)
  if (!match) return null
  const { collection, folder } = match
  const manifests = await Promise.all(profile.addons.map(async base => {
    try { return { base, manifest: await catalog.fetchJson(endpoint(base, '/manifest.json'), { redirect: 'error' }, 5000) } } catch { return null }
  }))
  const rows = [], errors = [], nextOffsets = []
  let hasMore = false
  if (folder.sources.length > 8) errors.push('TV folders support up to 8 sources. Open this folder in Izumi for all sources.')
  for (const [index, source] of folder.sources.slice(0, 8).entries()) {
    try {
      let items
      if (source.provider === 'addon') {
        const ordered = manifests.filter(Boolean).sort((a, b) => Number(b.manifest.id === source.addonId) - Number(a.manifest.id === source.addonId))
        let selected
        for (const addon of ordered) {
          const spec = (addon.manifest.catalogs || []).find(value => value.type === source.type && (value.id === source.catalogId || addon.manifest.id === source.addonId && value.id === source.catalogId.split(',')[0]))
          if (spec) { selected = { ...addon, spec }; break }
        }
        if (!selected) throw new Error(`Enable ${source.addonId} in TV sources to browse ${source.catalogId}.`)
        const extras = selected.spec.extra || []
        const required = extras.filter(value => value.isRequired && value.name !== 'skip' && !(value.name === 'genre' && source.genre))
        if (required.length) throw new Error(`Configure ${required.map(value => value.name).join(', ')} in this source first.`)
        const genres = extras.find(value => value.name === 'genre')?.options || selected.spec.genres
        if (source.genre && genres?.length && !genres.includes(source.genre)) throw new Error(`This source does not provide the genre ${source.genre}.`)
        const paged = extras.some(value => value.name === 'skip')
        if (page > 1 && !paged) continue
        const skip = offsets[index] ?? (page - 1) * 100
        const extra = [...(source.genre ? [`genre=${encodeURIComponent(source.genre)}`] : []), ...(skip ? [`skip=${skip}`] : [])].join('&')
        const value = await catalog.fetchJson(endpoint(selected.base, `/catalog/${encodeURIComponent(source.type)}/${encodeURIComponent(selected.spec.id)}${extra ? `/${extra}` : ''}.json`), { redirect: 'error' }, 8000)
        if (!Array.isArray(value.metas)) throw new Error('Source returned no catalogue data.')
        items = value.metas.map(raw => catalog.stremioMedia(raw, selected.base, source.type)).filter(Boolean)
        nextOffsets[index] = skip + Math.min(value.metas.length, 100)
        hasMore ||= paged && value.metas.length > 0
      } else if (source.provider === 'tmdb') {
        const request = collectionTmdbRequest(source, page)
        if (page > 1 && !['results', 'items'].includes(request.field)) continue
        const value = await catalog.tmdbRequest(profile.catalog.tmdbToken, request.path, { ...request.params, include_adult: profile.catalog.showAdult })
        if (!Array.isArray(value[request.field])) throw new Error('TMDB returned no collection items.')
        let raw = value[request.field]
        if (request.field === 'crew') raw = raw.filter(item => item.job?.toLowerCase() === 'director')
        if (['crew', 'cast'].includes(request.field)) raw = raw.filter(item => item.media_type === request.kind)
        if (request.field !== 'results' && source.sortBy && source.sortBy !== 'original') raw.sort((a, b) => source.sortBy === 'vote_average.desc' ? (b.vote_average || 0) - (a.vote_average || 0) : source.sortBy === 'vote_count.desc' ? (b.vote_count || 0) - (a.vote_count || 0) : source.sortBy.includes('date.desc') ? (b.release_date || b.first_air_date || '').localeCompare(a.release_date || a.first_air_date || '') : 0)
        items = raw.map(item => catalog.tmdbMedia(item, request.field === 'items' && item.media_type === 'tv' ? 'tv' : request.kind)).filter(Boolean)
        hasMore ||= page < Number(value.total_pages)
      } else throw new Error(`${source.provider.toUpperCase()} folders currently require the full Izumi client.`)
      rows.push({ id: `${screen}-${index}-${page}`, title: source.title || source.genre || source.catalogId || folder.title, kind: 'catalog', items: items.slice(0, 100) })
    } catch (error) { errors.push(String(error.message).slice(0, 240)) }
  }
  return { app: 'izumi', kind: 'companion-home', version: 1, revision: `cloud-${screen}-${Date.now()}`, generatedAt: Date.now(),
    catalog: { screen, label: `${collection.title} · ${folder.title}` },
    collectionPage: { page, hasMore, errors, nextOffsets: folder.sources.slice(0, 8).map((_, index) => nextOffsets[index] || 0) }, rows, hero: rows[0]?.items[0], spoilersHidden: profile.catalog.hideSpoilers }
}
