async function serviceJson(service, path, fetcher, method = 'GET', body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetcher(`${service.base}${path}`, {
      method, redirect: 'error', signal: controller.signal,
      headers: { ...(service.token && service.expires > Date.now() ? { Authorization: `Bearer ${service.token}` } : {}), 'Api-Key': service.apiKey, 'User-Agent': 'izumi v1.0.0', Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error('The subtitle service could not complete this request.')
    if (Number(response.headers.get('Content-Length')) > 512 * 1024) throw new Error('Subtitle response is too large.')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Subtitle response is empty.')
    const decoder = new TextDecoder()
    let text = ''
    let bytes = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 512 * 1024) { await reader.cancel(); throw new Error('Subtitle response is too large.') }
      text += decoder.decode(part.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } finally { clearTimeout(timer) }
}

/** Search is read-only; paid/quota-bearing download requests run only for the selected track. */
export async function searchSubtitleServices(profile, request, plan, fetcher = fetch) {
  const id = plan.ids.find(id => /^tt\d+(?::\d+:\d+)?$/.test(id))
  if (!id) return []
  const [title, season, episode] = id.split(':')
  const language = ({ eng: 'en', jpn: 'ja', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', por: 'pt' })[profile.subtitleLang] ?? (/^[a-z]{2}$/.test(profile.subtitleLang ?? '') ? profile.subtitleLang : 'en')
  const params = { languages: [...new Set([language, 'en'])].sort().join(',') }
  if (request.streamType === 'series') {
    if (!(episode || request.episode)) return []
    params.parent_imdb_id = String(Number(title.slice(2)))
    params.season_number = String(season ?? request.season ?? 1)
    params.episode_number = String(episode ?? request.episode)
  } else params.imdb_id = String(Number(title.slice(2)))
  const query = new URLSearchParams(Object.keys(params).sort().map(key => [key, params[key]]))
  return (await Promise.all((profile.subtitleServices ?? []).map(async (service, serviceIndex) => {
    try {
      const value = await serviceJson(service, `/subtitles?${query}`, fetcher)
      return (Array.isArray(value.data) ? value.data : []).slice(0, 24).flatMap(entry => {
        const file = entry?.attributes?.files?.[0]
        const fileId = Number(file?.file_id)
        if (!Number.isSafeInteger(fileId) || fileId <= 0) return []
        return [{ title: String(file.file_name || entry.attributes.release || '').slice(0, 160), lang: String(entry.attributes.language || '').slice(0, 24), download: { serviceIndex, fileId } }]
      })
    } catch { return [] }
  }))).flat()
}

export async function resolveSubtitleDownload(target, services, fetcher = fetch) {
  const service = services?.[target?.serviceIndex]
  if (!service || !Number.isSafeInteger(target.fileId) || target.fileId <= 0) throw new Error('This subtitle service is no longer configured.')
  const value = await serviceJson(service, '/download', fetcher, 'POST', { file_id: target.fileId, sub_format: 'srt' })
  if (typeof value.link !== 'string') throw new Error('The subtitle download is unavailable. Check the service account or choose another track.')
  return value.link
}
