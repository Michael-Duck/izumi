<script lang="ts">
  import { page } from '$app/state'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import Award from '@lucide/svelte/icons/award'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Search from '@lucide/svelte/icons/search'
  import Trophy from '@lucide/svelte/icons/trophy'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import {
    ANIME_AWARD_WINNERS,
    animeAwardCategories,
    animeAwardYears,
  } from '$lib/catalog/anime-awards'
  import { heroMedia } from '$lib/stores/hero'

  heroMedia.set(null)
  const ceremony = $derived(page.params.ceremony ?? '')
  const years = animeAwardYears()
  const requestedYear = Number(page.url.searchParams.get('year'))
  let year = $state(years.includes(requestedYear) ? requestedYear : years[0])
  let category = $state(page.url.searchParams.get('category')?.trim() || 'all')
  const categories = $derived(animeAwardCategories(year))
  const winners = $derived(ANIME_AWARD_WINNERS.filter((winner) =>
    winner.year === year && (category === 'all' || winner.category === category)))

  $effect(() => {
    if (category !== 'all' && !categories.includes(category)) category = 'all'
  })

  const searchHref = (title: string) => `/app/search?q=${encodeURIComponent(title)}`
</script>

<main class="min-h-full pb-20">
  {#if ceremony !== 'crunchyroll'}
    <div class="m-4 rounded-2xl border border-border bg-secondary/40 p-8 text-center sm:m-8">
      <h1 class="font-black">Award collection not found</h1>
      <a href="/app/home" data-focusable class="mt-4 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground">Return home</a>
    </div>
  {:else}
    <header class="relative overflow-hidden border-b border-orange-300/10 bg-[#0c0b13] px-4 pb-7 pt-5 text-white sm:px-8 sm:pb-10 sm:pt-8">
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_25%,rgba(251,146,60,.18),transparent_34%),linear-gradient(120deg,rgba(30,20,42,.96),rgba(7,7,12,.98))]"></div>
      <div class="relative mx-auto max-w-[96rem]">
        <a href="/app/home" data-focusable class="mb-7 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-bold text-white/70 hover:bg-white/10 hover:text-white"><ArrowLeft size={16} /> Home</a>
        <div class="flex items-center gap-4">
          <div class="grid size-16 shrink-0 place-items-center rounded-2xl bg-orange-300/15 text-orange-300 ring-1 ring-orange-300/20 sm:size-20"><Trophy size={36} /></div>
          <div>
            <p class="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Award discovery</p>
            <h1 class="mt-1 text-3xl font-black tracking-tight sm:text-5xl">Crunchyroll Anime Awards</h1>
            <p class="mt-2 max-w-2xl text-sm text-white/55">Browse winners by ceremony year and category, then jump straight into Izumi’s catalogue.</p>
          </div>
        </div>
        <button type="button" data-focusable onclick={() => void openUrl('https://www.crunchyroll.com/animeawards/')} class="mt-6 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-bold text-white/70 hover:bg-white/10 hover:text-white">Official awards site <ExternalLink size={14} /></button>
      </div>
    </header>

    <div class="mx-auto max-w-[96rem] px-4 pt-7 sm:px-8">
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label="Ceremony year">
        {#each years as option (option)}
          <button type="button" data-focusable aria-pressed={year === option} onclick={() => year = option}
            class="min-h-10 shrink-0 rounded-full border px-4 text-sm font-black transition-colors {year === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'}">{option}</button>
        {/each}
      </div>

      <div class="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label="Award category">
        <button type="button" data-focusable aria-pressed={category === 'all'} onclick={() => category = 'all'}
          class="min-h-10 shrink-0 rounded-full px-4 text-xs font-bold transition-colors {category === 'all' ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'}">All categories</button>
        {#each categories as option (option)}
          <button type="button" data-focusable aria-pressed={category === option} onclick={() => category = option}
            class="min-h-10 shrink-0 rounded-full px-4 text-xs font-bold transition-colors {category === option ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'}">{option}</button>
        {/each}
      </div>

      <section class="mt-8">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div><p class="text-xs font-black uppercase tracking-[0.18em] text-theme">{year} ceremony</p><h2 class="mt-1 text-2xl font-black">{category === 'all' ? 'Award winners' : category}</h2></div>
          <p class="text-sm text-muted-foreground">{winners.length} {winners.length === 1 ? 'winner' : 'winners'}</p>
        </div>
        {#if winners.length}
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {#each winners as winner (`${winner.year}:${winner.category}:${winner.title}`)}
              <a href={searchHref(winner.title)} data-focusable class="group flex min-h-32 items-center gap-4 rounded-2xl border border-border bg-secondary/40 p-4 transition-colors hover:border-orange-300/30 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-orange-300/10 text-orange-400"><Award size={23} /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-xs font-black uppercase tracking-wider text-muted-foreground">{winner.category}</span>
                  <span class="mt-1 block text-lg font-black leading-tight">{winner.title}</span>
                  <span class="mt-3 inline-flex items-center gap-1 text-xs font-black text-theme"><Search size={13} /> Find in Izumi</span>
                </span>
              </a>
            {/each}
          </div>
        {:else}
          <div class="rounded-2xl border border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">No winners are indexed for this category and year.</div>
        {/if}
      </section>
    </div>
  {/if}
</main>
