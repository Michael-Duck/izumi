<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import LibraryNav from '$lib/components/library/LibraryNav.svelte'
  import type { Media } from '$lib/anilist/types'
  import { cover, format, mediaHref, title } from '$lib/anilist/media'
  import { mediaKey } from '$lib/catalog/identity'
  import { loadDiscoveryCandidates, discoveryPresentation } from '$lib/recommendations/candidates'
  import { catalogProviders, catalogLabel, mergedCatalogProviders } from '$lib/settings/catalog'
  import { activeProfile } from '$lib/profiles/store'
  import { profileAllowsMedia } from '$lib/profiles/content'
  import { showAdult } from '$lib/settings/ui'
  import { openTrailerPopup, closeTrailerPopup } from '$lib/stores/trailer'
  import { playbackLanguageName } from '$lib/shared/languages'
  import Play from '@lucide/svelte/icons/play'
  import { WATCHLIST_ID, localLibrary, mediaIsInLocalList, setMediaInLocalList } from '$lib/library/local-lists'
  import { durableHistory } from '$lib/player/history'
  import {
    discoveryQueueFeedback,
    feedbackTasteSeeds,
    forgetDiscoveryDecision,
    historyTasteSeeds,
    libraryTasteSeeds,
    rankDiscoveryQueue,
    recordDiscoveryDecision,
    type DiscoveryQueueAction,
  } from '$lib/recommendations/discovery-queue'
  import { offlineMode } from '$lib/stores/offline'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import Bookmark from '@lucide/svelte/icons/bookmark'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Info from '@lucide/svelte/icons/info'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'

  type QueueFilter = 'all' | 'movie' | 'series' | 'anime'
  type LastDecision = { media: Media; action: DiscoveryQueueAction; alreadySaved: boolean }

  let pool = $state.raw<Media[]>([])
  let loading = $state(true)
  let loadingMore = $state(false)
  let error = $state('')
  let failedProviders = $state<string[]>([])
  let hasNextPage = $state(true)
  let enriched = $state.raw<Media | null>(null)
  let enriching = $state(false)
  let detailError = $state('')
  let mounted = $state(false)
  let nextPage = $state(1)
  let filter = $state<QueueFilter>('all')
  let lastDecision = $state<LastDecision | null>(null)
  let announcement = $state('')
  let cardOffset = $state(0)
  let pointerId = $state<number | null>(null)
  let restoredKey = $state<string | null>(null)
  let pointerMediaKey = ''
  let pointerOrigin = 0
  let loadAbort: AbortController | null = null

  const ranked = $derived.by(() => {
    const candidates = pool.filter(media => (!$showAdult ? !media.isAdult : true) && profileAllowsMedia(media, $activeProfile))
      .filter(media => filter === 'all' || (filter === 'movie' ? media.format === 'MOVIE' || media.catalog?.type === 'movie'
        : filter === 'anime' ? !media.catalog || media.catalog.type === 'anime' || media.type === 'ANIME'
        : media.format !== 'MOVIE' && media.catalog?.type !== 'movie' && media.type !== 'MANGA'))
    const seeds = [
      ...libraryTasteSeeds($localLibrary),
      ...historyTasteSeeds($durableHistory),
      ...feedbackTasteSeeds($discoveryQueueFeedback),
    ]
    return rankDiscoveryQueue(candidates, seeds, $discoveryQueueFeedback, {
      excludedKeys: [...Object.keys($localLibrary.entries ?? {}), ...Object.values($durableHistory).map(entry => mediaKey(entry.media))],
      limit: 60,
    })
  })
  const current = $derived(ranked.find(item => mediaKey(item.media) === restoredKey) ?? ranked[0])
  const remaining = $derived(ranked.length)
  const presented = $derived(enriched && current && mediaKey(enriched) === mediaKey(current.media) ? enriched : current?.media)
  const providerNames = $derived(mergedCatalogProviders($catalogProviders).map(catalogLabel).join(' · '))
  const displayRating = $derived(presented?.ratings?.[0]
    ? `${presented.ratings[0].score}/${presented.ratings[0].scale} · ${presented.ratings[0].source}`
    : presented?.averageScore ? `${Math.round(presented.averageScore)}/100 · ${catalogLabel(presented.catalog?.provider ?? 'anilist')}` : '')
  const trailerId = $derived(presented?.trailer?.site?.toLowerCase() === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(presented.trailer.id ?? '') ? presented.trailer.id : undefined)
  const synopsis = $derived(presented?.description?.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"') ?? '')

  $effect(() => {
    const media = current?.media
    enriched = null; detailError = ''
    if (!media) return
    const abort = new AbortController()
    enriching = true
    void discoveryPresentation(media, abort.signal).then(detail => {
      if (!abort.signal.aborted) {
        if (profileAllowsMedia(detail, $activeProfile) && ($showAdult || !detail.isAdult)) enriched = detail
        else pool = pool.filter(item => mediaKey(item) !== mediaKey(media))
      }
    }).catch(() => { if (!abort.signal.aborted) detailError = 'Extra details couldn’t load. You can still browse this pick.' })
      .finally(() => { if (!abort.signal.aborted) enriching = false })
    return () => { abort.abort(); closeTrailerPopup() }
  })

  $effect(() => {
    const context = JSON.stringify([$activeProfile.id, $catalogProviders])
    if (mounted && context) untrack(() => { lastDecision = null; restoredKey = null; void load(true) })
  })

  async function load(reset = false) {
    if (loadAbort && !reset) return
    if ($offlineMode) { loading = false; return }
    const page = reset ? 1 : nextPage
    if (reset) {
      loading = true
      pool = []
      nextPage = 1
    } else if (page > 1) loadingMore = true
    error = ''
    failedProviders = []
    if (reset) loadAbort?.abort()
    const abort = new AbortController()
    loadAbort = abort
    try {
      const result = await loadDiscoveryCandidates($catalogProviders, page, abort.signal)
      const media = result.media
      if (abort.signal.aborted || loadAbort !== abort) return
      const unique = new Map((reset ? media : [...pool, ...media]).map((item) => [mediaKey(item), item]))
      pool = [...unique.values()]
      nextPage = page + 1
      hasNextPage = result.hasNextPage
      failedProviders = result.failedProviders.map(catalogLabel)
    } catch (reason) {
      if (abort.signal.aborted || loadAbort !== abort) return
      error = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (loadAbort === abort) {
        loading = false
        loadingMore = false
        loadAbort = null
      }
    }
  }

  onMount(() => {
    mounted = true
    return () => { loadAbort?.abort(); closeTrailerPopup() }
  })

  function decide(action: DiscoveryQueueAction) {
    if (!current) return
    const media = presented ?? current.media
    restoredKey = null
    const alreadySaved = mediaIsInLocalList($localLibrary, media, WATCHLIST_ID)
    if (action === 'save' && !alreadySaved) setMediaInLocalList(media, WATCHLIST_ID, true)
    recordDiscoveryDecision(media, action)
    lastDecision = { media, action, alreadySaved }
    announcement = action === 'save'
      ? `${title(media)} saved to your watchlist.`
      : action === 'dismiss'
        ? `${title(media)} marked not for me.`
        : `${title(media)} snoozed for seven days.`
    cardOffset = 0
    if (ranked.length < 12 && hasNextPage && nextPage <= 5 && !loadingMore) void load()
  }

  function undo() {
    if (!lastDecision) return
    const previous = lastDecision
    filter = 'all'
    forgetDiscoveryDecision(previous.media)
    if (previous.action === 'save' && !previous.alreadySaved) {
      setMediaInLocalList(previous.media, WATCHLIST_ID, false)
    }
    if (!pool.some(media => mediaKey(media) === mediaKey(previous.media))) pool = [previous.media, ...pool]
    restoredKey = mediaKey(previous.media)
    announcement = `${title(previous.media)} restored to the queue.`
    lastDecision = null
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement | null)?.closest('button, a')) return
    if (!current || pointerId !== null) return
    pointerMediaKey = mediaKey(current.media)
    pointerId = event.pointerId
    pointerOrigin = event.clientX
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* optional */ }
  }

  function pointerMove(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    cardOffset = Math.max(-180, Math.min(180, event.clientX - pointerOrigin))
  }

  function pointerEnd(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    pointerId = null
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId) } catch { /* optional */ }
    if (current && mediaKey(current.media) === pointerMediaKey) {
      if (cardOffset <= -90) decide('skip')
      else if (cardOffset >= 90) decide('save')
    }
    cardOffset = 0
  }

  function pointerCancel() { pointerId = null; cardOffset = 0 }

  function changeFilter(value: QueueFilter) { filter = value; restoredKey = null; pointerCancel() }

  function handleKey(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
    if ((event.target as HTMLElement | null)?.closest('button, a, input, select, textarea')) return
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); decide('skip') }
    else if (event.key.toLowerCase() === 's') { event.preventDefault(); decide('save') }
    else if (event.key.toLowerCase() === 'u' && lastDecision) { event.preventDefault(); undo() }
  }
</script>

<svelte:head><title>Discover · izumi</title></svelte:head>
<LibraryNav />

<main class="mx-auto max-w-6xl px-4 pb-24 pt-7 sm:px-8 sm:pt-9">
  <header class="mb-7">
    <h1 class="text-3xl font-bold tracking-tight">Discover</h1>
    <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Your next great watch. A little familiar, a little unexpected.</p>
    <p class="mt-3 text-xs text-muted-foreground">From your enabled catalogs · {providerNames}</p>
  </header>

  <div class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
    <div class="flex gap-1" aria-label="Filter discovery queue">
      {#each [{ id: 'all', label: 'All' }, { id: 'movie', label: 'Movies' }, { id: 'series', label: 'Series' }, { id: 'anime', label: 'Anime' }] as option}
        <button type="button" data-focusable onclick={() => changeFilter(option.id as QueueFilter)} aria-pressed={filter === option.id} class="queue-button {filter === option.id ? 'bg-secondary font-semibold' : 'text-muted-foreground hover:text-foreground'}">{option.label}</button>
      {/each}
    </div>
    <button type="button" data-focusable onclick={undo} disabled={!lastDecision} class="queue-button text-muted-foreground disabled:opacity-35"><RotateCcw size={16} /> Undo last</button>
  </div>
  <p class="mb-4 min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">{announcement || 'Save what interests you. Skip anything you’re not in the mood for.'}</p>

  {#if $offlineMode}
    <section class="queue-state"><h2>Discovery needs a connection</h2><p>Your saved watchlist remains available offline.</p><a href="/app/library" data-focusable class="queue-button mt-5 bg-secondary">Open my lists</a></section>
  {:else if loading}
    <section aria-label="Loading discovery" aria-busy="true" class="grid gap-7 sm:grid-cols-[14rem_1fr]">
      <div class="aspect-[2/3] max-h-80 rounded-xl skeloader"></div>
      <div class="space-y-4 py-5"><div class="h-4 w-32 rounded skeloader"></div><div class="h-8 w-3/4 rounded skeloader"></div><div class="h-4 w-full rounded skeloader"></div><div class="h-4 w-2/3 rounded skeloader"></div></div>
    </section>
  {:else if error && !pool.length}
    <section class="queue-state">
      <h2>Couldn’t load your picks</h2>
      <p>{error}</p>
      <div class="mt-5 flex flex-wrap gap-2">
        <a href="/app/settings/catalog" data-focusable class="queue-button bg-foreground font-semibold text-background">Catalog settings</a>
        <button type="button" data-focusable onclick={() => load(true)} class="queue-button bg-secondary"><RefreshCw size={16} /> Retry</button>
      </div>
    </section>
  {:else if current}
    <!-- The focusable card deliberately owns single-letter shortcuts; they never run elsewhere in the app. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <article aria-label={`Discovery card for ${title(current.media)}`} aria-describedby="queue-shortcuts" tabindex="0" data-focusable onkeydown={handleKey} class="discovery-feature focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-foreground">
      <div class="discovery-art touch-pan-y select-none"
        onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerEnd} onpointercancel={pointerCancel}
        role="img" aria-label="Swipe artwork right to save, left to skip">
        {#if presented && (presented.bannerImage || cover(presented))}
          <img class="discovery-backdrop" src={presented.bannerImage || cover(presented)} alt="" draggable="false" style:transform={`scale(1.02) translateX(${cardOffset / 4}px)`} />
        {/if}
        <div class="art-shade"></div>
        <div class="art-controls">
          {#if trailerId}<button type="button" data-focusable onclick={() => openTrailerPopup(trailerId!, title(current.media))} class="trailer-button"><Play size={20} fill="currentColor" /> Watch trailer</button>
          {:else}<span class="trailer-status">{enriching ? 'Finding trailer & details…' : 'No trailer provided by this catalog'}</span>{/if}
        </div>
        {#if Math.abs(cardOffset) > 30}<span class="swipe-cue">{cardOffset > 0 ? 'Save to watchlist' : 'Skip for a week'}</span>{/if}
      </div>
      <div class="discovery-copy">
        <p class="discovery-eyebrow"><Sparkles size={15} />{current.exploration ? 'Beyond your usual' : 'Picked for you'}</p>
        <h2 aria-live="polite">{title(current.media)}</h2>
        <div class="discovery-facts">
          {#if format(current.media)}<span>{format(current.media)}</span>{/if}
          {#if presented?.startDate?.year}<span>{presented.startDate.year}</span>{/if}
          {#if presented?.duration}<span>{presented.duration} min</span>{/if}
          {#if presented?.contentRating}<span>{presented.contentRating}</span>{/if}
          {#if presented?.originalLanguage}<span>{playbackLanguageName(presented.originalLanguage)}</span>{/if}
          {#if displayRating}<span>{displayRating}</span>{/if}
        </div>
        {#if presented?.genres?.length}<p class="discovery-genres">{presented.genres.slice(0, 4).join(' / ')}</p>{/if}
        {#if synopsis}<p class="discovery-synopsis">{synopsis}</p>
        {:else}<p class="discovery-synopsis">This catalog hasn’t supplied a synopsis yet. Open full details to explore this title.</p>{/if}
        {#if presented?.creators?.length}<p class="discovery-credit">By {presented.creators.slice(0, 3).join(', ')}</p>{/if}
        <a href={mediaHref(current.media)} data-focusable class="queue-button -ml-3 text-muted-foreground hover:text-foreground"><Info size={16} /> Full details <ArrowRight size={15} /></a>
        <div class="discovery-actions">
          <button type="button" data-focusable onclick={() => decide('save')} class="queue-button bg-foreground font-semibold text-background"><Bookmark size={17} /> Save to watchlist</button>
          <button type="button" data-focusable onclick={() => decide('skip')} class="queue-button bg-secondary font-semibold">Skip for now <ArrowRight size={17} /></button>
          <button type="button" data-focusable onclick={() => decide('dismiss')} class="queue-button text-muted-foreground hover:text-foreground"><EyeOff size={15} /> Not for me</button>
        </div>
      </div>
      <section class="discovery-why" aria-label="Why this recommendation">
        <div><h3>Why this pick</h3><p>{current.reason}</p></div>
        <ul>{#each current.evidence as fact}<li>{fact}</li>{/each}</ul>
      </section>
    </article>
    {#if detailError}<p class="mt-4 text-xs text-muted-foreground" role="status">{detailError}</p>{/if}
    {#if failedProviders.length}<p class="mt-4 text-xs text-muted-foreground" role="status">{failedProviders.join(', ')} couldn’t load this time. These picks come from your other catalogs.</p>{/if}
    {#if error}<p role="alert" class="mt-5 text-sm text-muted-foreground">Couldn’t fetch more picks. You can keep browsing this batch.<button type="button" data-focusable onclick={() => load()} class="queue-button ml-2 underline">Retry</button></p>{/if}
  {:else}
    <section class="queue-state"><h2>You’re caught up</h2><p>Try another filter or load more picks. Skipped titles return after seven days.</p><button type="button" data-focusable onclick={() => { changeFilter('all'); void load() }} disabled={loadingMore} class="queue-button mt-5 bg-secondary disabled:opacity-40"><RefreshCw size={16} class={loadingMore ? 'animate-spin' : ''} /> More picks</button></section>
  {/if}

  <footer class="mt-7 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
    <div class="flex flex-wrap justify-between gap-x-4"><span id="queue-shortcuts">Focus the card: S to save · N to skip · U to undo. You can also swipe the artwork.</span>{#if remaining > 0}<span>{remaining} picks {loadingMore ? '· Loading more…' : 'ready'}</span>{/if}</div>
    <details class="mt-2"><summary class="cursor-pointer">How these picks work</summary><p class="mt-2 max-w-2xl">Izumi gathers candidates from your enabled catalogs and ranks them on this device using this profile’s library, durable watch history and discovery choices. Private playback history is never used. Shared genres, tags, creators and studios help when the catalog supplies them; ratings only break close ties. Known cross-catalog duplicates, watched and saved titles are excluded. A little variety keeps the deck from repeating one genre or source. “Not for me” adjusts future picks; “Skip for now” hides a title for seven days.</p></details>
  </footer>
</main>

<style>
  .discovery-feature { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); gap: 2.5rem; }
  .discovery-art { position: relative; min-height: 24rem; overflow: hidden; border-radius: .75rem; background: hsl(var(--secondary)); align-self: stretch; }
  .discovery-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .art-shade { position: absolute; inset: 0; background: linear-gradient(0deg, #000b, transparent 55%); pointer-events: none; }
  .art-controls { position: absolute; bottom: 1.5rem; left: 1.5rem; right: 1.5rem; display: flex; justify-content: center; }
  .trailer-button { display: inline-flex; align-items: center; gap: .7rem; min-height: 3rem; padding: .8rem 1.3rem; border: 1px solid #ffffff70; border-radius: 2rem; background: #151515cc; color: white; font-weight: 600; font-size: .85rem; backdrop-filter: blur(10px); }
  .trailer-button:focus-visible { outline: 3px solid white; outline-offset: 5px; }
  .trailer-status { color: #eee; font-size: .75rem; }
  .swipe-cue { position: absolute; inset: 40% 1rem auto; padding: 1rem; text-align: center; background: #111e; border-radius: .5rem; color: white; }
  .discovery-copy { align-self: center; padding: .5rem 0; min-width: 0; }
  .discovery-eyebrow { display: flex; align-items: center; gap: .5rem; color: hsl(var(--muted-foreground)); font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; }
  .discovery-copy h2 { font-size: clamp(1.6rem, 2.6vw, 2.5rem); line-height: 1.13; font-weight: 700; letter-spacing: -.025em; margin: 1rem 0; overflow-wrap: anywhere; }
  .discovery-facts { display: flex; flex-wrap: wrap; gap: .4rem 1rem; color: hsl(var(--muted-foreground)); font-size: .75rem; line-height: 1.7; }
  .discovery-genres { font-size: .75rem; margin-top: 1rem; }
  .discovery-synopsis { font-size: .875rem; line-height: 1.85; margin-top: 1.2rem; color: hsl(var(--muted-foreground)); display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
  .discovery-credit { font-size: .75rem; margin-top: 1rem; color: hsl(var(--muted-foreground)); }
  .discovery-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; }
  .discovery-why { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1.12fr; gap: 2.5rem; border-top: 1px solid hsl(var(--border)); padding-top: 1.5rem; }
  .discovery-why h3 { font-size: .8rem; font-weight: 600; }
  .discovery-why p { font-size: .85rem; line-height: 1.6; margin-top: .5rem; }
  .discovery-why ul { font-size: .75rem; line-height: 1.75; color: hsl(var(--muted-foreground)); display: grid; gap: .5rem; list-style: disc; padding-left: 1rem; }
  @media (max-width: 767px) {
    .discovery-feature { grid-template-columns: minmax(0, 1fr); gap: 1.3rem; }
    .discovery-art { min-height: 0; aspect-ratio: 16 / 10; }
    .discovery-copy { display: flex; flex-direction: column; }
    .discovery-copy h2 { font-size: 1.8rem; }
    .discovery-actions { order: 1; }
    .discovery-synopsis, .discovery-credit, .discovery-copy > a { order: 2; }
    .discovery-why { grid-template-columns: 1fr; gap: 1rem; }
  }
  .queue-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .6rem .85rem; font-size: .8rem; transition: opacity 150ms; }
  .queue-button:hover { opacity: .8; }
  .queue-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  .queue-state { padding: 2rem 0; }
  .queue-state h2 { font-size: 1.25rem; font-weight: 600; }
  .queue-state p { margin-top: .75rem; max-width: 36rem; font-size: .875rem; line-height: 1.75; color: hsl(var(--muted-foreground)); }
  @media (prefers-reduced-motion: reduce) { .queue-button { transition: none; } }
</style>
