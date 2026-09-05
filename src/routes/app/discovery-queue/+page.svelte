<script lang="ts">
  import { onMount } from 'svelte'
  import LibraryNav from '$lib/components/library/LibraryNav.svelte'
  import type { Media } from '$lib/anilist/types'
  import { cover, format, mediaHref, title } from '$lib/anilist/media'
  import { mediaKey } from '$lib/catalog/identity'
  import { CatalogConfigurationError } from '$lib/catalog/types'
  import { loadTmdbDiscoveryQueue } from '$lib/catalog/providers/tmdb'
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

  type QueueFilter = 'all' | 'movie' | 'series'
  type LastDecision = { media: Media; action: DiscoveryQueueAction; alreadySaved: boolean }

  let pool = $state.raw<Media[]>([])
  let loading = $state(true)
  let loadingMore = $state(false)
  let error = $state('')
  let needsConfiguration = $state(false)
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
    const candidates = filter === 'all' ? pool : pool.filter((media) =>
      filter === 'movie' ? media.catalog?.type === 'movie' : media.catalog?.type === 'series')
    const seeds = [
      ...libraryTasteSeeds($localLibrary),
      ...historyTasteSeeds($durableHistory),
      ...feedbackTasteSeeds($discoveryQueueFeedback),
    ]
    return rankDiscoveryQueue(candidates, seeds, $discoveryQueueFeedback, {
      excludedKeys: Object.keys($localLibrary.entries ?? {}),
      limit: 60,
    })
  })
  const current = $derived(ranked.find(item => mediaKey(item.media) === restoredKey) ?? ranked[0])
  const remaining = $derived(ranked.length)
  const displayRating = $derived(current?.media.averageScore ? `${Math.round(current.media.averageScore)}% TMDB` : '')

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
    needsConfiguration = false
    if (reset) loadAbort?.abort()
    const abort = new AbortController()
    loadAbort = abort
    try {
      const media = await loadTmdbDiscoveryQueue(page, abort.signal)
      if (abort.signal.aborted || loadAbort !== abort) return
      const unique = new Map((reset ? media : [...pool, ...media]).map((item) => [mediaKey(item), item]))
      pool = [...unique.values()]
      nextPage = page + 1
    } catch (reason) {
      if (abort.signal.aborted || loadAbort !== abort) return
      error = reason instanceof Error ? reason.message : String(reason)
      needsConfiguration = reason instanceof CatalogConfigurationError
    } finally {
      if (loadAbort === abort) {
        loading = false
        loadingMore = false
        loadAbort = null
      }
    }
  }

  onMount(() => {
    void load(true)
    return () => loadAbort?.abort()
  })

  function decide(action: DiscoveryQueueAction) {
    if (!current) return
    const media = current.media
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
    if (ranked.length < 12 && nextPage <= 5 && !loadingMore) void load()
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
    <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Find a film or series for your watchlist, one title at a time.</p>
  </header>

  <div class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
    <div class="flex gap-1" aria-label="Filter discovery queue">
      {#each [{ id: 'all', label: 'All' }, { id: 'movie', label: 'Movies' }, { id: 'series', label: 'Series' }] as option}
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
      <h2>{needsConfiguration ? 'Set up film discovery' : 'Couldn’t load your picks'}</h2>
      <p>{needsConfiguration ? 'Discover uses TMDB for films and series. Add your TMDB access token in Catalog settings to get started.' : error}</p>
      <div class="mt-5 flex flex-wrap gap-2">
        {#if needsConfiguration}<a href="/app/settings/catalog" data-focusable class="queue-button bg-foreground font-semibold text-background">Set up TMDB</a>{/if}
        <button type="button" data-focusable onclick={() => load(true)} class="queue-button bg-secondary"><RefreshCw size={16} /> Retry</button>
      </div>
    </section>
  {:else if current}
    <!-- The focusable card deliberately owns single-letter shortcuts; they never run elsewhere in the app. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <article aria-label={`Discovery card for ${title(current.media)}`} aria-describedby="queue-shortcuts" tabindex="0" data-focusable onkeydown={handleKey} class="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-foreground">
      <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-5 gap-y-4 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-7 lg:grid-cols-[16rem_1fr] lg:gap-9">
        <div class="relative aspect-[2/3] w-full touch-pan-y select-none overflow-hidden rounded-xl bg-muted sm:row-span-2"
          onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerEnd} onpointercancel={pointerCancel}
          role="img" aria-label="Swipe artwork right to save, left to skip">
          {#if cover(current.media)}<img src={cover(current.media)} alt="" draggable="false" class="h-full w-full object-cover" style:transform={`translateX(${cardOffset / 4}px)`} />
          {:else}<div class="grid h-full place-items-center text-muted-foreground"><Bookmark size={32} strokeWidth={1} /></div>{/if}
          {#if Math.abs(cardOffset) > 30}<span class="absolute inset-x-3 bottom-4 rounded-lg bg-black/80 px-3 py-3 text-center text-sm font-semibold text-white">{cardOffset > 0 ? 'Save to watchlist' : 'Skip for a week'}</span>{/if}
        </div>
        <div class="min-w-0 py-1">
          <p class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Sparkles size={15} class="shrink-0" />{current.reason}</p>
          <h2 aria-live="polite" class="mt-3 text-xl font-bold leading-tight tracking-tight sm:mt-4 sm:text-3xl">{title(current.media)}</h2>
          <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {#if format(current.media)}<span>{format(current.media)}</span>{/if}
            {#if current.media.startDate?.year}<span>{current.media.startDate.year}</span>{/if}
            {#if displayRating}<span>{displayRating}</span>{/if}
          </div>
        </div>
        <div class="col-span-2 min-w-0 sm:col-span-1">
          {#if current.media.description}<p class=" line-clamp-4 max-w-2xl sm:line-clamp-5 text-sm leading-7 text-muted-foreground">{current.media.description}</p>{/if}
          <a href={mediaHref(current.media)} data-focusable class="queue-button -ml-3 mt-3 text-muted-foreground hover:text-foreground"><Info size={16} /> Full details</a>
          <div class="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
            <button type="button" data-focusable onclick={() => decide('save')} class="queue-button bg-foreground font-semibold text-background"><Bookmark size={17} /> Save to watchlist</button>
            <button type="button" data-focusable onclick={() => decide('skip')} class="queue-button bg-secondary font-semibold">Skip for now <ArrowRight size={17} /></button>
          </div>
          <button type="button" data-focusable onclick={() => decide('dismiss')} class="queue-button -ml-3 mt-2 text-xs text-muted-foreground hover:text-foreground"><EyeOff size={15} /> Not for me</button>
        </div>
      </div>
    </article>
    {#if error}<p role="alert" class="mt-5 text-sm text-muted-foreground">Couldn’t fetch more picks. You can keep browsing this batch.<button type="button" data-focusable onclick={() => load()} class="queue-button ml-2 underline">Retry</button></p>{/if}
  {:else}
    <section class="queue-state"><h2>You’re caught up</h2><p>Try another filter or load more picks. Skipped titles return after seven days.</p><button type="button" data-focusable onclick={() => { changeFilter('all'); void load() }} disabled={loadingMore} class="queue-button mt-5 bg-secondary disabled:opacity-40"><RefreshCw size={16} class={loadingMore ? 'animate-spin' : ''} /> More picks</button></section>
  {/if}

  <footer class="mt-7 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
    <div class="flex flex-wrap justify-between gap-x-4"><span id="queue-shortcuts">Focus the card: S to save · N to skip · U to undo. You can also swipe the artwork.</span>{#if remaining > 0}<span>{remaining} picks {loadingMore ? '· Loading more…' : 'ready'}</span>{/if}</div>
    <details class="mt-2"><summary class="cursor-pointer">How these picks work</summary><p class="mt-2 max-w-2xl">Films, series and ratings come from TMDB. Izumi ranks them on this device using this profile’s history, library and discovery choices. “Not for me” adjusts future picks; “Skip for now” hides a title for seven days.</p></details>
  </footer>
</main>

<style>
  .queue-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .6rem .85rem; font-size: .8rem; transition: opacity 150ms; }
  .queue-button:hover { opacity: .8; }
  .queue-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  .queue-state { padding: 2rem 0; }
  .queue-state h2 { font-size: 1.25rem; font-weight: 600; }
  .queue-state p { margin-top: .75rem; max-width: 36rem; font-size: .875rem; line-height: 1.75; color: hsl(var(--muted-foreground)); }
  @media (prefers-reduced-motion: reduce) { .queue-button { transition: none; } }
</style>
