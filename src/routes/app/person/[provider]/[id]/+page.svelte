<script lang="ts">
  import { page } from '$app/state'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import MapPin from '@lucide/svelte/icons/map-pin'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import UserRound from '@lucide/svelte/icons/user-round'
  import CatalogSectionRow from '$lib/components/catalog/CatalogSectionRow.svelte'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { tmdbPersonProfile, type TmdbPersonProfile } from '$lib/catalog/providers/tmdb'
  import { heroMedia } from '$lib/stores/hero'
  import { offlineMode } from '$lib/stores/offline'
  import { openUrl } from '@tauri-apps/plugin-opener'

  heroMedia.set(null)
  const provider = $derived(page.params.provider ?? '')
  const id = $derived(page.params.id ?? '')
  let profile = $state.raw<TmdbPersonProfile | null>(null)
  let loading = $state(true)
  let error = $state('')
  let retryKey = $state(0)
  let biographyOpen = $state(false)

  function date(value?: string) {
    if (!value) return ''
    const parsed = new Date(`${value}T12:00:00`)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function lifespan(person: TmdbPersonProfile) {
    if (!person.birthday) return ''
    const from = new Date(`${person.birthday}T12:00:00`)
    const to = person.deathday ? new Date(`${person.deathday}T12:00:00`) : new Date()
    let age = to.getFullYear() - from.getFullYear()
    if (to.getMonth() < from.getMonth() || (to.getMonth() === from.getMonth() && to.getDate() < from.getDate())) age--
    return person.deathday ? `${date(person.birthday)} – ${date(person.deathday)} · ${age}` : `Born ${date(person.birthday)} · Age ${age}`
  }

  $effect(() => {
    const personId = id
    const source = provider
    void retryKey
    if ($offlineMode) { loading = false; return }
    if (source !== 'tmdb') {
      error = 'This person provider is not supported.'
      loading = false
      return
    }
    const abort = new AbortController()
    loading = true
    error = ''
    profile = null
    void tmdbPersonProfile(personId, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) profile = result
      })
      .catch((reason) => {
        if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Couldn’t load this person.'
      })
      .finally(() => { if (!abort.signal.aborted) loading = false })
    return () => abort.abort()
  })
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Person pages are unavailable offline" subtitle="Reconnect to load this filmography." />
{:else}
  <main class="mx-auto max-w-[96rem] p-4 pb-20 sm:p-8">
    <a href="/app/home" data-focusable class="mb-6 inline-flex min-h-10 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      <ArrowLeft size={16} /> Home
    </a>

    {#if loading}
      <div class="mb-10 flex gap-5">
        <div class="skeloader aspect-[2/3] w-32 shrink-0 rounded-2xl sm:w-44"></div>
        <div class="flex-1 space-y-3 pt-2"><div class="skeloader h-9 w-72 max-w-full rounded"></div><div class="skeloader h-4 w-44 rounded"></div><div class="skeloader h-20 max-w-2xl rounded"></div></div>
      </div>
    {:else if error}
      <div class="rounded-2xl border border-destructive/40 bg-destructive/10 p-8 text-center">
        <h1 class="text-xl font-black">Couldn’t load this person</h1>
        <p class="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{error}</p>
        <button type="button" data-focusable onclick={() => retryKey++} class="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-black text-background"><RotateCcw size={15} /> Retry</button>
      </div>
    {:else if profile}
      <header class="mb-10 grid gap-6 sm:grid-cols-[11rem_minmax(0,1fr)]">
        {#if profile.image}
          <img src={profile.image} alt="" class="aspect-[2/3] w-36 rounded-2xl bg-secondary object-cover shadow-xl sm:w-44" />
        {:else}
          <div class="grid aspect-[2/3] w-36 place-items-center rounded-2xl bg-secondary text-muted-foreground sm:w-44"><UserRound size={52} /></div>
        {/if}
        <div class="min-w-0 self-center">
          <p class="text-xs font-black uppercase tracking-[0.18em] text-theme">{profile.knownFor || 'Film and television'}</p>
          <h1 class="mt-1 text-3xl font-black tracking-tight sm:text-5xl">{profile.name}</h1>
          {#if profile.aliases.length}<p class="mt-2 text-sm text-muted-foreground">Also known as {profile.aliases.slice(0, 3).join(' · ')}</p>{/if}
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {#if profile.gender}<span>{profile.gender}</span>{/if}
            {#if lifespan(profile)}<span>{lifespan(profile)}</span>{/if}
            {#if profile.birthplace}<span class="inline-flex items-center gap-1"><MapPin size={14} /> {profile.birthplace}</span>{/if}
          </div>
          {#if profile.biography}
            <div class="mt-5 max-w-3xl">
              <p class="whitespace-pre-line text-sm leading-relaxed text-muted-foreground {biographyOpen ? '' : 'line-clamp-4'}">{profile.biography}</p>
              <button type="button" data-focusable onclick={() => biographyOpen = !biographyOpen} class="mt-2 text-sm font-black text-theme">{biographyOpen ? 'Show less' : 'Read biography'}</button>
            </div>
          {/if}
          <div class="mt-5 flex flex-wrap gap-2">
            <button type="button" data-focusable onclick={() => void openUrl(`https://www.themoviedb.org/person/${profile!.id}`)} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-bold hover:bg-accent">TMDB <ExternalLink size={14} /></button>
            {#if profile.imdbId}<button type="button" data-focusable onclick={() => void openUrl(`https://www.imdb.com/name/${profile!.imdbId}/`)} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-bold hover:bg-accent">IMDb <ExternalLink size={14} /></button>{/if}
            {#if profile.homepage}<button type="button" data-focusable onclick={() => void openUrl(profile!.homepage!)} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-bold hover:bg-accent">Official site <ExternalLink size={14} /></button>{/if}
          </div>
        </div>
      </header>

      {#if profile.cast.length}
        <CatalogSectionRow section={{ id: 'cast', title: 'Acting credits', media: profile.cast }} />
      {/if}
      {#if profile.crew.length}
        <CatalogSectionRow section={{ id: 'crew', title: 'Crew credits', media: profile.crew }} />
      {/if}
      {#if !profile.cast.length && !profile.crew.length}
        <div class="rounded-2xl border border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">No filmography is available for this person.</div>
      {/if}
    {:else}
      <div class="rounded-2xl border border-border bg-secondary/40 p-8 text-center"><h1 class="font-black">Person not found</h1><p class="mt-1 text-sm text-muted-foreground">TMDB did not return a profile for this identifier.</p></div>
    {/if}
  </main>
{/if}
