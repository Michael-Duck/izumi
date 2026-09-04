<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import type { Media } from '$lib/anilist/types'
  import { banner, cover, format, mediaHref, title } from '$lib/anilist/media'
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
  import X from '@lucide/svelte/icons/x'

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
  const current = $derived(ranked[0])
  const remaining = $derived(ranked.length)
  const displayRating = $derived(current?.media.averageScore ? `${Math.round(current.media.averageScore)}% TMDB` : '')

  async function load(reset = false) {
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
      const unique = new Map((reset ? media : [...pool, ...media]).map((item) => [mediaKey(item), item]))
      pool = [...unique.values()]
      nextPage = page + 1
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
      needsConfiguration = reason instanceof CatalogConfigurationError
    } finally {
      loading = false
      loadingMore = false
    }
  }

  onMount(() => {
    void load(true)
    return () => loadAbort?.abort()
  })

  function decide(action: DiscoveryQueueAction) {
    if (!current) return
    const media = current.media
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
    forgetDiscoveryDecision(previous.media)
    if (previous.action === 'save' && !previous.alreadySaved) {
      setMediaInLocalList(previous.media, WATCHLIST_ID, false)
    }
    announcement = `${title(previous.media)} restored to the queue.`
    lastDecision = null
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement | null)?.closest('button, a')) return
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
    if (cardOffset <= -90) decide('skip')
    else if (cardOffset >= 90) decide('save')
    cardOffset = 0
  }

  function handleKey(event: KeyboardEvent) {
    if ((event.target as HTMLElement | null)?.closest('button, a, input, select, textarea')) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); decide('skip') }
    else if (event.key === 'ArrowRight') { event.preventDefault(); decide('save') }
    else if (event.key === 'Backspace' && lastDecision) { event.preventDefault(); undo() }
  }
</script>

<svelte:window onkeydown={handleKey} />
<svelte:head><title>Discovery Queue · izumi</title></svelte:head>

<main class="mx-auto min-h-screen max-w-7xl px-4 pb-24 pt-8 sm:px-8 sm:pt-14">
  <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <div class="mb-2 flex items-center gap-2 text-primary"><Sparkles size={17} /><span class="text-[11px] font-black uppercase tracking-[0.2em]">Discovery Queue</span></div>
      <h1 class="text-3xl font-black tracking-tight sm:text-5xl">Find the next thing.</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Swipe right to save, left to skip for a week. “Not for me” teaches this profile’s local taste model.</p>
    </div>
    <div class="flex rounded-xl bg-secondary/70 p-1" aria-label="Filter discovery queue">
      {#each [{ id: 'all', label: 'All' }, { id: 'movie', label: 'Movies' }, { id: 'series', label: 'Series' }] as option}
        <button data-focusable onclick={() => (filter = option.id as QueueFilter)} aria-pressed={filter === option.id}
          class="min-h-9 rounded-lg px-3 text-xs font-black transition {filter === option.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">{option.label}</button>
      {/each}
    </div>
  </header>

  <p class="sr-only" aria-live="polite">{announcement}</p>

  {#if $offlineMode}
    <section class="rounded-3xl border border-border bg-card p-8 text-center">
      <h2 class="text-xl font-black">Discovery needs a connection</h2>
      <p class="mt-2 text-sm text-muted-foreground">Your saved watchlist remains available offline.</p>
    </section>
  {:else if loading}
    <section class="relative min-h-[62vh] overflow-hidden rounded-3xl border border-border bg-card">
      <div class="absolute inset-0 skeloader"></div><div class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"></div>
      <div class="absolute bottom-8 left-6 right-6 space-y-3 sm:left-10"><div class="h-4 w-40 rounded skeloader"></div><div class="h-12 w-2/3 rounded skeloader"></div><div class="h-4 w-1/2 rounded skeloader"></div></div>
    </section>
  {:else if error && !pool.length}
    <section class="rounded-3xl border border-destructive/30 bg-destructive/10 p-8">
      <h2 class="text-xl font-black">Couldn’t build the queue</h2><p class="mt-2 text-sm text-muted-foreground">{error}</p>
      <div class="mt-5 flex flex-wrap gap-2">
        {#if needsConfiguration}<a href="/app/settings/catalog" data-focusable class="rounded-xl bg-primary px-4 py-2 text-sm font-black text-primary-foreground">Add TMDB token</a>{/if}
        <button data-focusable onclick={() => load(true)} class="inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2 text-sm font-black"><RefreshCw size={16} /> Retry</button>
      </div>
    </section>
  {:else if current}
    <section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <article aria-label={`Discovery card for ${title(current.media)}`} class="relative min-h-[62vh] touch-pan-y select-none overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
        onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerEnd} onpointercancel={pointerEnd}
        style={`transform:translateX(${cardOffset}px) rotate(${cardOffset / 42}deg); transition:${pointerId == null ? 'transform 180ms ease' : 'none'}`}>
        {#if banner(current.media)}<img src={banner(current.media)} alt="" draggable="false" class="absolute inset-0 h-full w-full object-cover" />{/if}
        <div class="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10"></div>
        <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/20"></div>
        {#if cardOffset < -30}<div class="absolute right-7 top-7 rotate-6 rounded-xl border-4 border-white px-4 py-2 text-2xl font-black uppercase text-white">Skip</div>{/if}
        {#if cardOffset > 30}<div class="absolute left-7 top-7 -rotate-6 rounded-xl border-4 border-emerald-300 px-4 py-2 text-2xl font-black uppercase text-emerald-300">Save</div>{/if}
        <div class="absolute inset-x-0 bottom-0 max-w-3xl p-6 text-white sm:p-10">
          <div class="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold text-white/75">
            <span class="rounded-full bg-primary px-3 py-1 text-primary-foreground">{current.reason}</span>
            {#if format(current.media)}<span>{format(current.media)}</span>{/if}
            {#if current.media.startDate?.year}<span>· {current.media.startDate.year}</span>{/if}
            {#if displayRating}<span>· {displayRating}</span>{/if}
          </div>
          <h2 class="text-4xl font-black leading-none tracking-tight sm:text-6xl">{title(current.media)}</h2>
          {#if current.media.description}<p class="mt-4 line-clamp-3 max-w-2xl text-sm leading-6 text-white/78 sm:text-base">{current.media.description}</p>{/if}
          <div class="mt-6 flex flex-wrap gap-2">
            <button data-focusable onclick={() => decide('dismiss')} class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-black/45 px-4 text-sm font-black ring-1 ring-white/20 backdrop-blur hover:bg-black/65"><EyeOff size={17} /> Not for me</button>
            <button data-focusable onclick={() => decide('skip')} class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/12 px-4 text-sm font-black ring-1 ring-white/20 backdrop-blur hover:bg-white/20"><X size={18} /> Skip</button>
            <button data-focusable onclick={() => decide('save')} class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-black text-black hover:bg-white/90"><Bookmark size={17} /> Save</button>
            <button data-focusable onclick={() => goto(mediaHref(current.media))} class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/12 px-4 text-sm font-black ring-1 ring-white/20 backdrop-blur hover:bg-white/20"><Info size={18} /> Details</button>
          </div>
        </div>
      </article>

      <aside class="flex flex-col gap-4">
        <div class="rounded-2xl border border-border bg-card p-5">
          <div class="flex items-center justify-between"><span class="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">In this deck</span><span class="text-2xl font-black">{remaining}</span></div>
          <p class="mt-2 text-xs leading-5 text-muted-foreground">Ranking happens on this device from this profile’s history, library and queue feedback.</p>
          {#if lastDecision}<button data-focusable onclick={undo} class="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-black"><RotateCcw size={16} /> Undo last</button>{/if}
        </div>
        <div class="hidden overflow-hidden rounded-2xl border border-border bg-card p-3 lg:block">
          <p class="px-2 pb-3 text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">Coming up</p>
          <div class="space-y-2">
            {#each ranked.slice(1, 5) as item (mediaKey(item.media))}
              <div class="flex items-center gap-3 rounded-xl bg-secondary/45 p-2">
                <div class="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-muted">{#if cover(item.media)}<img src={cover(item.media)} alt="" class="h-full w-full object-cover" />{/if}</div>
                <div class="min-w-0"><p class="truncate text-xs font-black">{title(item.media)}</p><p class="mt-1 truncate text-[10px] text-muted-foreground">{item.reason}</p></div>
              </div>
            {/each}
          </div>
        </div>
      </aside>
    </section>
  {:else}
    <section class="rounded-3xl border border-border bg-card p-8 text-center">
      <Sparkles size={30} class="mx-auto text-primary" /><h2 class="mt-4 text-2xl font-black">You’re caught up</h2>
      <p class="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Try another filter or load a fresh batch. Skipped titles return automatically after seven days.</p>
      <div class="mt-5 flex flex-wrap justify-center gap-2">
        <button data-focusable onclick={() => { filter = 'all'; void load() }} disabled={loadingMore} class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground disabled:opacity-50"><RefreshCw size={17} class={loadingMore ? 'animate-spin' : ''} /> More picks</button>
        {#if lastDecision}<button data-focusable onclick={undo} class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-secondary px-5 text-sm font-black"><RotateCcw size={16} /> Undo last</button>{/if}
      </div>
    </section>
  {/if}

  <footer class="mt-5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
    <span>← skip · → save · Backspace undo</span><span>Candidate data and ratings: TMDB</span>
  </footer>
</main>
