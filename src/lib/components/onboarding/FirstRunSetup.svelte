<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Check from '@lucide/svelte/icons/check'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import CircleHelp from '@lucide/svelte/icons/circle-help'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Film from '@lucide/svelte/icons/film'
  import Languages from '@lucide/svelte/icons/languages'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import Play from '@lucide/svelte/icons/play'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { fetchExtensionInfo } from '$lib/extensions/manager'
  import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime.js'
  import { m } from '$lib/paraglide/messages.js'
  import {
    catalogDefaultProvider,
    catalogProviders,
    omdbApiKey,
    selectCatalogScreen,
    tmdbReadToken,
  } from '$lib/settings/catalog'
  import {
    finishOnboarding,
    onboardingCatalogPlan,
    onboardingSteps,
    onboardingComplete,
    type OnboardingFocus,
    type OnboardingMovieMetadata,
  } from '$lib/settings/onboarding'
  import { debridKey, extensionUrls, preferredAudioLang, preferredSubLang } from '$lib/settings/ui'
  import { fetchManifest } from '$lib/stremio/manifest'
  import {
    addonUrls,
    CINEMETA_BASE,
    disabledSources,
    normalizeBase,
    replaceAddonBase,
  } from '$lib/stremio/sources'
  import { anilistToken, kitsuToken, malToken, simklToken } from '$lib/trackers/config'

  const tmdbSettingsUrl = 'https://www.themoviedb.org/settings/api'
  const omdbSettingsUrl = 'https://www.omdbapi.com/apikey.aspx'
  const initialProvider = get(catalogDefaultProvider)

  let root = $state<HTMLElement>()
  let step = $state(0)
  let locale = $state(getLocale())
  let focus = $state<OnboardingFocus>(initialProvider === 'merged' ? 'both' : initialProvider === 'tmdb' || initialProvider === 'stremio' ? 'movies' : 'anime')
  let movieMetadata = $state<OnboardingMovieMetadata>(initialProvider === 'stremio' ? 'stremio' : 'tmdb')
  let tmdbToken = $state(get(tmdbReadToken))
  let ratingsKey = $state(get(omdbApiKey))
  let audioLanguage = $state(get(preferredAudioLang))
  let subtitleLanguage = $state(get(preferredSubLang))
  let showTmdbToken = $state(false)
  let showRatingsKey = $state(false)
  let externalError = $state('')
  let sourceHealth = $state<'empty' | 'checking' | 'ready' | 'error'>('empty')

  const sourceConfigured = $derived($addonUrls.length > 0 || $extensionUrls.length > 0)
  const trackerReady = $derived(Boolean($anilistToken || $malToken || $kitsuToken || $simklToken))
  const debridReady = $derived(Boolean($debridKey))
  const selectedProvider = $derived(focus === 'anime' ? m.onboarding_automatic_anime() : (focus === 'both' ? m.onboarding_automatic_anime() + ' + ' : '') + (movieMetadata === 'tmdb' ? 'TMDB' : 'Stremio'))
  const steps = $derived(onboardingSteps(focus))
  const totalSteps = $derived(steps.length)
  const stepIndex = $derived(steps.indexOf(step))
  const stepLabels = $derived([
    m.onboarding_welcome_title(),
    m.onboarding_focus_step(),
    m.onboarding_catalog_step(),
    m.onboarding_access_step(),
    m.onboarding_playback_step(),
    m.onboarding_review_step(),
  ])

  function changeLocale(next: Locale) {
    locale = next
    setLocale(next)
  }

  function goBack() {
    if (stepIndex > 0) step = steps[stepIndex - 1]
  }

  function goNext() {
    if (stepIndex < steps.length - 1) step = steps[stepIndex + 1]
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      goBack()
      return
    }
    if (event.key !== 'Tab' || !root) return
    const focusable = [...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function openExternal(url: string) {
    externalError = ''
    try {
      await openUrl(url)
    } catch (cause) {
      externalError = cause instanceof Error ? cause.message : m.onboarding_external_error()
    }
  }

  async function checkSources(addons: string[], extensions: string[]) {
    if (!addons.length && !extensions.length) {
      sourceHealth = 'empty'
      return
    }
    sourceHealth = 'checking'
    const checks = await Promise.all([
      ...addons.map(async (url) => Boolean(await fetchManifest(url).catch(() => null))),
      ...extensions.map(async (url) => {
        const info = await fetchExtensionInfo(url).catch(() => null)
        return Boolean(info && (info.configs.length > 0 || info.packages?.length))
      }),
    ])
    sourceHealth = checks.some(Boolean) ? 'ready' : 'error'
  }

  function applyProfile() {
    preferredAudioLang.set(audioLanguage)
    preferredSubLang.set(subtitleLanguage)
    const plan = onboardingCatalogPlan(focus, movieMetadata)
    catalogProviders.set(plan.providers)
    catalogDefaultProvider.set(plan.defaultProvider)
    selectCatalogScreen(plan.defaultProvider)

    if (focus !== 'anime' && movieMetadata === 'tmdb') {
      tmdbReadToken.set(tmdbToken.trim())
      omdbApiKey.set(ratingsKey.trim())
    }
    if (focus !== 'anime' && movieMetadata === 'stremio') {
      addonUrls.update((urls) => replaceAddonBase(urls, undefined, CINEMETA_BASE))
      disabledSources.update((urls) => urls.filter((url) => normalizeBase(url) !== normalizeBase(CINEMETA_BASE)))
    }
  }

  function complete() {
    applyProfile()
    finishOnboarding()
  }

  function skip() {
    finishOnboarding()
  }

  async function openSettings(path: string) {
    applyProfile()
    finishOnboarding()
    await goto(path)
  }

  $effect(() => {
    if (step === 4) void checkSources([...$addonUrls], [...$extensionUrls])
  })

  $effect(() => {
    step
    requestAnimationFrame(() => root?.querySelector<HTMLElement>('[data-step-heading]')?.focus())
  })

  onMount(() => {
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
    }
  })
</script>

{#snippet heading(title: string, body: string)}
  <h1 id="setup-title" data-step-heading tabindex="-1" class="text-3xl font-bold tracking-tight outline-none sm:text-4xl">{title}</h1>
  <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{body}</p>
{/snippet}

{#if !$onboardingComplete}
  <div bind:this={root} role="dialog" aria-modal="true" aria-labelledby="setup-title" tabindex="-1" data-nav-trap class="onboarding-surface fixed inset-0 z-[160] flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground" onkeydown={handleKeydown}>
    <header class="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10">
      <span class="text-xl font-bold tracking-tight">izumi</span>
      <span class="text-xs text-muted-foreground">{m.onboarding_step_count({ current: String(stepIndex + 1), total: String(totalSteps) })}</span>
    </header>
    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-60 shrink-0 border-r border-border px-5 py-10 lg:block">
        <ol class="space-y-2" aria-label={m.onboarding_progress_label()}>
          {#each steps as value, index}
            <li class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm {value === step ? 'bg-secondary font-semibold' : 'text-muted-foreground'}" aria-current={value === step ? 'step' : undefined}>
              <span class="grid size-6 shrink-0 place-items-center rounded-full border border-current text-xs">{#if index < stepIndex}<Check size={13} />{:else}{index + 1}{/if}</span>
              {stepLabels[value]}
            </li>
          {/each}
        </ol>
        <p class="mt-10 px-3 text-xs leading-relaxed text-muted-foreground">{m.onboarding_change_later_hint()}</p>
      </aside>
      <main class="min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-8 sm:px-10 sm:py-12">
        <div class="mx-auto max-w-3xl">
          {#if step === 0}
            {@render heading(m.onboarding_welcome_title(), m.onboarding_welcome_body())}
            <div class="mt-9">
              <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold"><Languages size={17} />{m.onboarding_language()}</h2>
              <div class="grid grid-cols-2 gap-3">
                {#each [{ id: 'en', label: 'English' }, { id: 'ja', label: '日本語' }] as choice}
                  <button type="button" data-focusable onclick={() => changeLocale(choice.id as Locale)} aria-pressed={locale === choice.id} class="setup-choice min-h-14 px-4 text-left font-semibold {locale === choice.id ? 'selected' : ''}">{choice.label}</button>
                {/each}
              </div>
            </div>
            <p class="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">{m.onboarding_once_detail()}</p>
          {:else if step === 1}
            {@render heading(m.onboarding_focus_title(), m.onboarding_focus_body())}
            <div class="mt-7 space-y-3">
              {#each [{ id: 'anime', title: m.onboarding_anime_title(), body: m.onboarding_automatic_body(), Icon: Sparkles }, { id: 'movies', title: m.onboarding_movies_title(), body: m.onboarding_movies_body(), Icon: Film }, { id: 'both', title: m.onboarding_both_title(), body: m.onboarding_both_body(), Icon: LibraryBig }] as choice}
                <button type="button" data-focusable onclick={() => focus = choice.id as OnboardingFocus} aria-pressed={focus === choice.id} class="setup-choice flex w-full items-center gap-4 p-5 text-left {focus === choice.id ? 'selected' : ''}">
                  <choice.Icon size={24} class="shrink-0 text-muted-foreground" />
                  <span class="min-w-0 flex-1"><span class="block text-lg font-semibold">{choice.title}</span><span class="mt-1 block text-sm leading-relaxed text-muted-foreground">{choice.body}</span>{#if choice.id === 'anime'}<span class="mt-2 block text-xs font-semibold">{m.onboarding_automatic_anime()}</span>{/if}</span>
                  <span class="grid size-5 shrink-0 place-items-center rounded-full border border-foreground/40">{#if focus === choice.id}<Check size={13} />{/if}</span>
                </button>
              {/each}
            </div>
          {:else if step === 2}
            {@render heading(m.onboarding_metadata_title(), m.onboarding_metadata_body())}
            {#if focus === 'both'}<p class="mt-5 flex items-start gap-2 text-sm"><Sparkles size={17} class="mt-0.5 shrink-0" />{m.onboarding_both_included()}</p>{/if}
            <div class="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" data-focusable onclick={() => movieMetadata = 'tmdb'} aria-pressed={movieMetadata === 'tmdb'} class="setup-choice p-5 text-left {movieMetadata === 'tmdb' ? 'selected' : ''}">
                <span class="flex items-center justify-between gap-3"><img src="/brand/tmdb.svg" alt="TMDB" class="h-7 w-auto max-w-24" /><span class="text-xs text-muted-foreground">{m.onboarding_recommended()}</span></span>
                <span class="mt-6 block text-xl font-semibold">{m.onboarding_tmdb_title()}</span><span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_tmdb_body()}</span>
              </button>
              <button type="button" data-focusable onclick={() => movieMetadata = 'stremio'} aria-pressed={movieMetadata === 'stremio'} class="setup-choice p-5 text-left {movieMetadata === 'stremio' ? 'selected' : ''}">
                <Play size={27} class="text-muted-foreground" />
                <span class="mt-6 block text-xl font-semibold">{m.onboarding_stremio_title()}</span><span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_stremio_body()}</span>
              </button>
            </div>
            {#if movieMetadata === 'stremio'}<p class="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><CircleHelp size={16} class="shrink-0" />{m.onboarding_stremio_warning()}</p>{/if}
          {:else if step === 3}
            {#if movieMetadata === 'tmdb'}
              {@render heading(m.onboarding_tmdb_access_title(), m.onboarding_tmdb_access_body())}
              <details class="mt-7 rounded-xl border border-border p-5">
                <summary class="cursor-pointer font-semibold">{m.onboarding_access_expand()}<span class="ml-3 text-xs font-normal text-muted-foreground">{tmdbToken.trim() ? m.onboarding_tmdb_token_saved() : m.onboarding_optional_now()}</span></summary>
                <div class="mt-5">
                  <label for="setup-tmdb-token" class="text-sm font-semibold">{m.onboarding_tmdb_token_label()}</label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{m.onboarding_access_draft()}</p>
                  <div class="relative mt-3">
                    <input id="setup-tmdb-token" data-focusable bind:value={tmdbToken} type={showTmdbToken ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="h-12 w-full rounded-lg bg-input px-3 pr-12 font-mono text-sm" placeholder="eyJhbGciOiJIUzI1NiJ9…" />
                    <button type="button" data-focusable onclick={() => showTmdbToken = !showTmdbToken} aria-label={showTmdbToken ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showTmdbToken}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
                  </div>
                  <details class="mt-5 border-t border-border pt-4">
                    <summary class="cursor-pointer text-sm">{m.onboarding_access_help()}</summary>
                    <ol class="mt-4 list-decimal space-y-3 pl-5 text-xs leading-relaxed text-muted-foreground">
                      {#each [m.onboarding_tmdb_instruction_1(), m.onboarding_tmdb_instruction_2(), m.onboarding_tmdb_instruction_3(), m.onboarding_tmdb_instruction_4()] as instruction}<li>{instruction}</li>{/each}
                    </ol>
                    <button type="button" data-focusable onclick={() => void openExternal(tmdbSettingsUrl)} class="setup-button mt-4 bg-secondary"><ExternalLink size={15} />{m.onboarding_open_tmdb()}</button>
                  </details>
                </div>
              </details>
              <details class="mt-3 border-b border-border px-1 py-4">
                <summary class="cursor-pointer text-sm text-muted-foreground">{m.onboarding_ratings_expand()}</summary>
                <div class="mt-4">
                  <label for="setup-ratings-key" class="text-sm font-semibold">{m.onboarding_omdb_key_label()}</label><p class="mt-2 text-xs leading-relaxed text-muted-foreground">{m.onboarding_omdb_key_hint()}</p>
                  <div class="relative mt-3">
                    <input id="setup-ratings-key" data-focusable bind:value={ratingsKey} type={showRatingsKey ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="h-12 w-full rounded-lg bg-input px-3 pr-12 font-mono text-sm" />
                    <button type="button" data-focusable onclick={() => showRatingsKey = !showRatingsKey} aria-label={showRatingsKey ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showRatingsKey}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
                  </div>
                  <button type="button" data-focusable onclick={() => void openExternal(omdbSettingsUrl)} class="setup-button mt-3 bg-secondary"><ExternalLink size={15} />{m.onboarding_get_omdb()}</button>
                </div>
              </details>
              <div class="mt-7 flex items-center gap-4"><img src="/brand/tmdb.svg" alt="TMDB" class="h-5 w-auto max-w-20 shrink-0" /><p class="text-xs leading-relaxed text-muted-foreground">{m.onboarding_tmdb_attribution()}</p></div>
              {#if externalError}<p class="mt-3 text-sm text-destructive" role="alert">{externalError}</p>{/if}
            {:else}
              {@render heading(m.onboarding_stremio_access_title(), m.onboarding_stremio_access_body())}
              <p class="mt-7 flex items-start gap-3 border-b border-border pb-6 text-sm leading-relaxed"><Check size={20} class="shrink-0" />{m.onboarding_no_key_body()}</p>
              <h2 class="mt-6 text-sm font-semibold">{m.onboarding_stremio_limit_title()}</h2><p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_stremio_limit_body()}</p>
            {/if}
          {:else if step === 4}
            {@render heading(m.onboarding_preferences_title(), m.onboarding_preferences_body())}
            <div class="mt-7 grid gap-4 sm:grid-cols-2">
              <label class="grid gap-2 text-sm font-semibold">{m.player_audio_language()}<select data-focusable bind:value={audioLanguage} class="h-12 rounded-lg bg-input px-3 font-normal"><option value="jpn">Japanese</option><option value="eng">English</option></select></label>
              <label class="grid gap-2 text-sm font-semibold">{m.player_subtitle_language()}<select data-focusable bind:value={subtitleLanguage} class="h-12 rounded-lg bg-input px-3 font-normal"><option value="eng">English</option><option value="jpn">日本語</option><option value="none">{m.cast_subtitles_off()}</option></select></label>
            </div>
            <h2 class="mt-9 text-base font-semibold">{m.onboarding_connections_title()}</h2><p class="mt-2 text-sm text-muted-foreground">{m.onboarding_connections_body()}</p>
            <div class="mt-4 divide-y divide-border border-y border-border">
              <div class="flex flex-wrap items-center gap-3 py-4">
                <LibraryBig size={19} class="text-muted-foreground" /><span class="min-w-40 flex-1"><span class="block text-sm font-semibold">{m.onboarding_sources()}</span><span class="mt-1 block text-xs text-muted-foreground">{sourceHealth === 'checking' ? m.onboarding_checking() : sourceHealth === 'ready' ? m.onboarding_ready() : sourceHealth === 'error' ? m.onboarding_source_unavailable() : m.onboarding_needs_source()}</span></span>
                {#if !sourceConfigured || sourceHealth === 'error'}<button type="button" data-focusable onclick={() => void openSettings('/app/settings/sources')} title={m.onboarding_finish_settings()} class="setup-button bg-secondary">{m.onboarding_open_sources()}<ArrowRight size={14} /></button>{/if}
              </div>
              {#each [{ label: m.onboarding_tracker(), ready: trackerReady, path: '/app/settings/accounts' }, { label: m.onboarding_debrid(), ready: debridReady, path: '/app/settings/sources' }] as item}
                <div class="flex flex-wrap items-center gap-3 py-4"><Check size={19} class="text-muted-foreground" /><span class="min-w-40 flex-1"><span class="block text-sm font-semibold">{item.label}</span><span class="mt-1 block text-xs text-muted-foreground">{item.ready ? m.onboarding_ready() : m.onboarding_optional()}</span></span>{#if !item.ready}<button type="button" data-focusable onclick={() => void openSettings(item.path)} title={m.onboarding_finish_settings()} class="setup-button bg-secondary">{m.onboarding_open_accounts()}<ArrowRight size={14} /></button>{/if}</div>
              {/each}
            </div>
            <p class="mt-4 text-xs text-muted-foreground">{m.onboarding_finish_settings()}</p>
          {:else}
            {@render heading(m.onboarding_review_title(), m.onboarding_review_body())}
            <dl class="mt-7 divide-y divide-border border-y border-border">
              <div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_focus_summary()}</dt><dd class="mt-1 text-lg font-semibold">{focus === 'both' ? m.onboarding_both_title() : focus === 'anime' ? m.onboarding_anime_title() : m.onboarding_movies_title()}</dd></div>
              <div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_catalog_summary()}</dt><dd class="mt-1 text-lg font-semibold">{selectedProvider}</dd></div>
              {#if focus !== 'anime' && movieMetadata === 'tmdb'}<div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_optional_access_summary()}</dt><dd class="mt-1 text-sm">{tmdbToken.trim() ? m.onboarding_tmdb_token_saved() : m.onboarding_add_later()}</dd></div>{/if}
            </dl>
            <p class="mt-6 text-xs leading-relaxed text-muted-foreground">{m.onboarding_review_once_hint()}</p>
          {/if}
        </div>
      </main>
    </div>
    <footer class="shrink-0 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-10">
      <div class="mx-auto flex max-w-3xl items-center justify-between gap-3">
        {#if step === 0}<button type="button" data-focusable onclick={skip} class="setup-button text-muted-foreground hover:bg-secondary">{m.onboarding_skip()}</button>
        {:else}<button type="button" data-focusable onclick={goBack} class="setup-button hover:bg-secondary"><ChevronLeft size={17} />{m.onboarding_back()}</button>{/if}
        {#if step < 5}<button type="button" data-focusable onclick={goNext} class="setup-button bg-foreground text-background">{step === 0 ? m.onboarding_start() : m.onboarding_next()}<ArrowRight size={17} /></button>
        {:else}<button type="button" data-focusable onclick={complete} class="setup-button bg-foreground text-background"><Check size={17} />{m.onboarding_finish()}</button>{/if}
      </div>
    </footer>
  </div>
{/if}

<style>
  .setup-choice { border: 1px solid hsl(var(--border)); border-radius: .75rem; transition: background 150ms, border-color 150ms; }
  .setup-choice:hover { background: hsl(var(--secondary)); }
  .setup-choice.selected { border-color: hsl(var(--foreground) / .6); background: hsl(var(--foreground) / .05); }
  .setup-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .65rem 1rem; font-size: .8rem; font-weight: 600; }
  .onboarding-surface button:focus-visible, .onboarding-surface input:focus-visible, .onboarding-surface select:focus-visible, .onboarding-surface summary:focus-visible { outline: 2px solid hsl(var(--foreground)); outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) { .setup-choice { transition: none; } }
</style>
