<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import Save from '@lucide/svelte/icons/save'
  import Copy from '@lucide/svelte/icons/copy'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import Download from '@lucide/svelte/icons/download'
  import Upload from '@lucide/svelte/icons/upload'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Check from '@lucide/svelte/icons/check'
  import { saveTextFile, ioErrorMessage } from '$lib/player/history-io'
  import { themePreset } from '$lib/settings/ui'
  import {
    activeStudioTheme,
    activeStudioThemeId,
    defaultStudioTheme,
    deleteStudioTheme,
    duplicateStudioTheme,
    hexToHslToken,
    hslTokenToHex,
    parseStudioTheme,
    saveStudioTheme,
    stringifyStudioTheme,
    studioThemes,
    themeStudioPreview,
    tokenContrast,
    type StudioTheme,
    type ThemeBackdrop,
    type ThemeFont,
  } from '$lib/settings/theme-studio'
  import { THEME_PRESETS, type ThemeTokens } from '$lib/theme-tokens'

  type PresetName = keyof typeof THEME_PRESETS
  type EditableToken = Exclude<keyof ThemeTokens, 'scheme'>

  const clone = (theme: StudioTheme): StudioTheme => JSON.parse(JSON.stringify(theme)) as StudioTheme
  let draft = $state<StudioTheme>(clone(get(activeStudioTheme)))
  let notice = $state('')
  let category = $state<'palette' | 'type' | 'backdrop' | 'saved'>('palette')
  let baseline = $state(JSON.stringify(get(activeStudioTheme)))
  let confirmDelete = $state(false)
  const dirty = $derived(JSON.stringify(draft) !== baseline)
  const previewStyle = $derived(Object.entries(draft.tokens).filter(([key]) => key !== 'scheme').map(([key, value]) => `--${key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}:${value}`).join(';'))
  const previewFont = $derived(({ nunito: 'Nunito, sans-serif', system: 'system-ui, sans-serif', serif: 'Georgia, serif', mono: 'Geist Mono, monospace' })[draft.font])
  let importInput = $state<HTMLInputElement>()

  const paletteStarters: Array<{ id: PresetName; label: string }> = [
    { id: 'izumi', label: 'Izumi' }, { id: 'midnight', label: 'Midnight' },
    { id: 'sakura', label: 'Sakura' }, { id: 'ocean', label: 'Ocean' }, { id: 'light', label: 'Light' },
  ]
  const colorGroups: Array<{ label: string; items: Array<{ key: EditableToken; label: string }> }> = [
    { label: 'Canvas', items: [
      { key: 'background', label: 'Background' }, { key: 'foreground', label: 'Text' },
      { key: 'card', label: 'Cards' }, { key: 'cardForeground', label: 'Card text' },
    ] },
    { label: 'Actions', items: [
      { key: 'theme', label: 'Brand accent' }, { key: 'ring', label: 'Focus ring' },
      { key: 'primary', label: 'Primary action' }, { key: 'primaryForeground', label: 'Primary text' },
    ] },
    { label: 'Surfaces', items: [
      { key: 'secondary', label: 'Secondary' }, { key: 'secondaryForeground', label: 'Secondary text' },
      { key: 'accent', label: 'Hover surface' }, { key: 'accentForeground', label: 'Hover text' },
      { key: 'muted', label: 'Muted surface' }, { key: 'mutedForeground', label: 'Muted text' },
      { key: 'border', label: 'Borders' }, { key: 'input', label: 'Inputs' },
    ] },
  ]
  const fonts: Array<{ id: ThemeFont; label: string; sample: string }> = [
    { id: 'nunito', label: 'Nunito', sample: 'Warm & rounded' },
    { id: 'system', label: 'System', sample: 'Native & direct' },
    { id: 'serif', label: 'Editorial', sample: 'Cinematic & literary' },
    { id: 'mono', label: 'Geist Mono', sample: 'Technical & precise' },
  ]
  const backdrops: Array<{ id: ThemeBackdrop; label: string }> = [
    { id: 'solid', label: 'Solid' }, { id: 'aurora', label: 'Aurora' },
    { id: 'spotlight', label: 'Spotlight' }, { id: 'mesh', label: 'Mesh' },
  ]

  const contrasts = $derived([
    { label: 'Body text', value: tokenContrast(draft.tokens.foreground, draft.tokens.background) },
    { label: 'Muted text', value: tokenContrast(draft.tokens.mutedForeground, draft.tokens.background) },
    { label: 'Primary button', value: tokenContrast(draft.tokens.primaryForeground, draft.tokens.primary) },
  ])
  const contrastPasses = $derived(contrasts.every((item) => item.value >= 4.5))

  $effect(() => {
    themeStudioPreview.set(clone(draft))
  })
  onDestroy(() => themeStudioPreview.set(null))

  function updateColor(key: EditableToken, event: Event) {
    draft.tokens[key] = hexToHslToken((event.currentTarget as HTMLInputElement).value)
  }

  function applyStarter(id: PresetName) {
    draft.tokens = { ...THEME_PRESETS[id] }
    draft.tokens.scheme = id === 'light' ? 'light' : 'dark'
    notice = `${paletteStarters.find((item) => item.id === id)?.label} palette loaded as a draft.`
  }

  function selectTheme(id: string) {
    confirmDelete = false
    if (dirty) { notice = 'Save or discard your changes before choosing another theme.'; return }
    const selected = $studioThemes.find((theme) => theme.id === id)
    if (!selected) return
    draft = clone(selected)
    baseline = JSON.stringify(selected)
    notice = ''
  }

  function saveAndApply() {
    const saved = saveStudioTheme(clone(draft))
    draft = clone(saved)
    baseline = JSON.stringify(saved)
    $themePreset = 'custom'
    notice = `${saved.name} saved and applied.`
  }

  function makeCopy() {
    const copy = duplicateStudioTheme(clone(draft), Date.now(), false)
    draft = clone(copy)
    baseline = JSON.stringify(copy)
    notice = 'Created a separate editable copy.'
  }

  function removeCurrent() {
    if (!confirmDelete) { confirmDelete = true; return }
    confirmDelete = false
    const remaining = $studioThemes.filter((theme) => theme.id !== draft.id)
    if (!deleteStudioTheme(draft.id)) {
      notice = 'Keep at least one saved theme.'
      return
    }
    draft = clone(remaining[0] ?? defaultStudioTheme())
    baseline = JSON.stringify(draft)
    notice = 'Theme deleted.'
  }

  function discardChanges() {
    draft = clone($studioThemes.find(theme => theme.id === draft.id) ?? get(activeStudioTheme))
    baseline = JSON.stringify(draft)
    notice = 'Draft reset to the saved version.'
  }

  function resetDesign() {
    const reset = defaultStudioTheme()
    draft = { ...reset, id: draft.id, name: draft.name, createdAt: draft.createdAt, tokens: { ...reset.tokens } }
    notice = 'Izumi defaults loaded as a draft.'
  }

  async function exportTheme() {
    try {
      const filename = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'izumi-theme'}.izumi-theme.json`
      const saved = await saveTextFile(filename, stringifyStudioTheme(draft))
      if (saved) notice = 'Theme file saved.'
    } catch (error) {
      notice = ioErrorMessage(error, 'Theme export failed.')
    }
  }

  async function importTheme(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (dirty) { notice = 'Save or discard your changes before importing a theme.'; return }
    if (file.size > 64_000 || $studioThemes.length >= 24) { notice = 'Use a theme file under 64 KB and keep fewer than 24 saved themes.'; return }
    try {
      const imported = parseStudioTheme(await file.text())
      $studioThemes = [...$studioThemes, imported]
      baseline = JSON.stringify(imported)
      draft = clone(imported)
      notice = `${imported.name} loaded. Changes are live; save the theme to keep them.`
    } catch (error) {
      notice = ioErrorMessage(error, 'Invalid theme file.')
    }
  }
</script>

<svelte:head><title>Theme Studio · izumi</title></svelte:head>

<div class="mx-auto max-w-6xl p-4 pb-24 sm:p-8">
  <header class="mb-7 flex flex-wrap items-center justify-between gap-4">
    <div><h2 class="text-3xl font-bold tracking-tight">Theme Studio</h2><p class="mt-2 text-sm text-muted-foreground">Changes appear across the app as you edit. Save to keep them.</p></div>
    <div class="flex items-center gap-2">
      <button type="button" data-focusable onclick={discardChanges} disabled={!dirty} class="studio-button disabled:opacity-35"><RotateCcw size={15} /> Discard</button>
      <button type="button" data-focusable onclick={saveAndApply} class="studio-button bg-foreground text-background"><Save size={15} /> Save theme</button>
    </div>
  </header>
  {#if notice}<p role="status" class="mb-5 border-l-2 border-foreground/40 py-2 pl-4 text-sm text-muted-foreground">{notice}</p>{/if}

  <div class="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
    <div class="min-w-0">
      <div class="mb-5 flex items-end gap-3">
        <label class="min-w-0 flex-1"><span class="mb-2 block text-xs font-semibold text-muted-foreground">Theme name{dirty ? ' · Unsaved changes' : ''}</span><input bind:value={draft.name} maxlength="48" data-focusable class="h-11 w-full rounded-lg bg-input px-3 text-base" /></label>
        <select aria-label="Colour scheme" bind:value={draft.tokens.scheme} data-focusable class="h-11 rounded-lg bg-secondary px-3 text-sm"><option value="dark">Dark</option><option value="light">Light</option></select>
      </div>
      <nav aria-label="Theme controls" class="mb-6 flex gap-5 overflow-x-auto border-b border-border">
        {#each [{ id: 'palette', label: 'Palette' }, { id: 'type', label: 'Type & shape' }, { id: 'backdrop', label: 'Backdrop' }, { id: 'saved', label: 'Saved themes' }] as item}
          <button type="button" data-focusable aria-current={category === item.id ? 'page' : undefined} onclick={() => { category = item.id as typeof category; confirmDelete = false }} class="min-h-12 shrink-0 border-b-2 text-sm font-semibold {category === item.id ? 'border-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}">{item.label}</button>
        {/each}
      </nav>
      {#if category === 'palette'}
        <h3 class="text-sm font-semibold">Start with a palette</h3>
        <div class="mb-7 mt-3 grid grid-cols-5 gap-2">
          {#each paletteStarters as starter}
            <button type="button" data-focusable onclick={() => applyStarter(starter.id)} class="min-w-0 rounded-lg p-1 text-left hover:bg-secondary" aria-label={`Load ${starter.label} palette`}>
              <span class="mb-2 flex h-12 overflow-hidden rounded-md ring-1 ring-inset ring-foreground/10"><span class="flex-1" style={`background:hsl(${THEME_PRESETS[starter.id].background})`}></span><span class="flex-1" style={`background:hsl(${THEME_PRESETS[starter.id].card})`}></span><span class="w-1/4" style={`background:hsl(${THEME_PRESETS[starter.id].theme})`}></span></span>
              <span class="block truncate text-xs font-medium">{starter.label}</span>
            </button>
          {/each}
        </div>
        {#each colorGroups as group}
          <details class="border-t border-border py-4" open={group.label === 'Canvas'}>
            <summary class="cursor-pointer text-sm font-semibold">{group.label}<span class="ml-2 text-xs font-normal text-muted-foreground">{group.items.length} colours</span></summary>
            <div class="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {#each group.items as item}
                <label class="flex min-w-0 items-center gap-3"><input type="color" value={hslTokenToHex(draft.tokens[item.key])} oninput={(event) => updateColor(item.key, event)} data-focusable aria-label={item.label} class="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-1" /><span class="min-w-0"><span class="block text-sm">{item.label}</span><span class="font-mono text-xs text-muted-foreground">{hslTokenToHex(draft.tokens[item.key]).toUpperCase()}</span></span></label>
              {/each}
            </div>
          </details>
        {/each}
      {:else if category === 'type'}
        <h3 class="mb-4 text-base font-semibold">Type &amp; shape</h3>
        <div class="grid grid-cols-2 gap-3">
          {#each fonts as font}
            <button type="button" data-focusable onclick={() => draft.font = font.id} aria-pressed={draft.font === font.id} class="rounded-lg border p-4 text-left {draft.font === font.id ? 'border-foreground/60 bg-foreground/5' : 'border-border hover:bg-secondary'}">
              <span class="block text-lg font-semibold">{font.label}</span><span class="mt-2 block text-xs text-muted-foreground">{font.sample}</span>
            </button>
          {/each}
        </div>
        <label class="mt-7 block"><span class="flex justify-between text-sm"><span>Type &amp; UI scale</span><span class="tabular-nums text-muted-foreground">{Math.round(draft.fontScale * 100)}%</span></span><input bind:value={draft.fontScale} type="range" min="0.85" max="1.2" step="0.01" data-focusable class="mt-3 w-full accent-[hsl(var(--foreground))]" /></label>
        <label class="mt-6 block"><span class="flex justify-between text-sm"><span>Corner radius</span><span class="tabular-nums text-muted-foreground">{draft.radius.toFixed(2)}rem</span></span><input bind:value={draft.radius} type="range" min="0" max="2" step="0.05" data-focusable class="mt-3 w-full accent-[hsl(var(--foreground))]" /></label>
      {:else if category === 'backdrop'}
        <h3 class="mb-4 text-base font-semibold">Ambient backdrop</h3>
        <div class="grid grid-cols-2 gap-3">{#each backdrops as backdrop}<button type="button" data-focusable onclick={() => draft.backdrop = backdrop.id} aria-pressed={draft.backdrop === backdrop.id} class="min-h-14 rounded-lg border text-sm {draft.backdrop === backdrop.id ? 'border-foreground/60 bg-foreground/5' : 'border-border hover:bg-secondary'}">{backdrop.label}</button>{/each}</div>
        <label class="mt-7 block"><span class="flex justify-between text-sm"><span>Strength</span><span class="tabular-nums text-muted-foreground">{Math.round(draft.backdropStrength * 100)}%</span></span><input bind:value={draft.backdropStrength} type="range" min="0" max="0.65" step="0.01" data-focusable class="mt-3 w-full accent-[hsl(var(--foreground))]" /></label>
        <label class="mt-6 block"><span class="flex justify-between text-sm"><span>Mesh softness</span><span class="tabular-nums text-muted-foreground">{draft.glassBlur}px</span></span><input bind:value={draft.glassBlur} type="range" min="0" max="40" step="1" data-focusable class="mt-3 w-full accent-[hsl(var(--foreground))]" /></label>
      {:else}
        <div class="mb-4 flex items-center justify-between"><h3 class="text-base font-semibold">Saved themes</h3><span class="text-xs text-muted-foreground">{$studioThemes.length} / 24</span></div>
        <div class="divide-y divide-border">
          {#each $studioThemes as theme}
            <button type="button" data-focusable onclick={() => selectTheme(theme.id)} aria-pressed={theme.id === draft.id} class="flex min-h-16 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-secondary">
              <span class="flex size-9 shrink-0 overflow-hidden rounded-md"><span class="w-2/3" style={`background:hsl(${theme.tokens.background})`}></span><span class="w-1/3" style={`background:hsl(${theme.tokens.theme})`}></span></span>
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">{theme.name}</span>{#if theme.id === $activeStudioThemeId && $themePreset === 'custom'}<span class="text-xs text-muted-foreground">Applied</span>{/if}{#if theme.id === draft.id}<Check size={16} />{/if}
            </button>
          {/each}
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" data-focusable onclick={makeCopy} disabled={$studioThemes.length >= 24} class="studio-button bg-secondary disabled:opacity-35"><Copy size={15} /> Duplicate</button>
          <button type="button" data-focusable onclick={removeCurrent} disabled={$studioThemes.length <= 1} class="studio-button text-destructive disabled:opacity-35"><Trash2 size={15} />{confirmDelete ? 'Confirm delete' : 'Delete selected'}</button>
          {#if confirmDelete}<button type="button" data-focusable onclick={() => confirmDelete = false} class="studio-button">Keep theme</button>{/if}
        </div>
        <div class="mt-6 border-t border-border pt-5">
          <p class="text-xs leading-5 text-muted-foreground">Import or export a theme file. Files contain appearance settings only, never accounts or history.</p>
          <div class="mt-3 flex flex-wrap gap-2"><button type="button" data-focusable onclick={exportTheme} class="studio-button bg-secondary"><Download size={15} /> Export JSON</button><button type="button" data-focusable onclick={() => importInput?.click()} class="studio-button bg-secondary"><Upload size={15} /> Import JSON</button></div>
          <input bind:this={importInput} onchange={importTheme} type="file" accept="application/json,.json,.izumi-theme.json" class="hidden" />
        </div>
        <button type="button" data-focusable onclick={resetDesign} class="studio-button mt-5 text-muted-foreground"><RotateCcw size={15} /> Reset design controls</button>
      {/if}
    </div>

    <aside class="min-w-0 xl:sticky xl:top-8">
      <div class="mb-3 flex items-center justify-between"><h3 class="text-sm font-semibold">Live preview</h3><span class="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : draft.id === $activeStudioThemeId && $themePreset === 'custom' ? 'Saved theme' : 'Not saved as active'}</span></div>
      <section aria-label="Theme preview" style={previewStyle} class="studio-preview relative overflow-hidden border border-border bg-background text-foreground" style:font-family={previewFont} style:border-radius={`${draft.radius}rem`}>
        {#if draft.backdrop !== 'solid'}<div aria-hidden="true" class="studio-ambience" data-backdrop={draft.backdrop} style:opacity={draft.backdropStrength} style:filter={`blur(${draft.glassBlur}px)`}></div>{/if}
        <div class="relative p-6" style:font-size={`${draft.fontScale}rem`}>
          <div class="flex items-center gap-4 border-b border-border pb-4 text-[0.75em]"><span class="font-semibold text-theme">izumi</span><span>Home</span><span class="text-muted-foreground">Library</span></div>
          <p class="mt-10 text-[0.7em] text-muted-foreground">Tonight’s watchlist</p><h4 class="mt-2 text-[2em] font-bold leading-tight tracking-tight">A little space<br />for your stories.</h4>
          <p class="mt-4 max-w-xs text-[0.8em] leading-relaxed text-muted-foreground">Your colours, typography and surfaces update across the app as you edit.</p>
          <div class="mt-6 flex gap-2"><span class="rounded-[var(--sample-radius)] bg-primary px-4 py-2 text-[0.75em] font-semibold text-primary-foreground" style:--sample-radius={`${draft.radius / 2}rem`}>Continue watching</span><span class="rounded-md bg-secondary px-3 py-2 text-[0.75em] text-secondary-foreground">Details</span></div>
          <div class="mt-8 grid grid-cols-3 gap-3">{#each ['Movies', 'Series', 'Anime'] as label}<div class="rounded-lg bg-card p-3 ring-1 ring-border"><div class="h-12 rounded bg-muted"></div><p class="mt-3 text-[0.7em] text-card-foreground">{label}</p></div>{/each}</div>
        </div>
      </section>
      <details class="mt-3 border-t border-border py-4">
        <summary class="cursor-pointer text-sm font-semibold">Contrast check <span class="ml-2 text-xs font-normal text-muted-foreground">{contrastPasses ? 'Text pairs pass AA' : 'Review text contrast'}</span></summary>
        <div class="mt-4 space-y-3">{#each contrasts as contrast}<div class="flex justify-between text-xs"><span>{contrast.label}</span><span class="tabular-nums text-muted-foreground">{contrast.value.toFixed(2)}:1 {contrast.value >= 4.5 ? '· Pass' : '· Review'}</span></div>{/each}</div>
        <p class="mt-4 text-xs leading-5 text-muted-foreground">Normal text needs 4.5:1 contrast for WCAG AA. You can still save a lower-contrast theme.</p>
      </details>
    </aside>
  </div>
</div>
<style>
  .studio-button { display: inline-flex; min-height: 2.5rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .5rem .85rem; font-size: .75rem; font-weight: 600; transition: opacity 150ms; }
  .studio-button:hover { opacity: .8; }
  .studio-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  .studio-ambience { position: absolute; inset: 0; background: radial-gradient(ellipse at 90% 10%, hsl(var(--theme)), transparent 70%); pointer-events: none; }
  .studio-ambience[data-backdrop="spotlight"] { background: radial-gradient(circle at 50% 15%, hsl(var(--theme)), transparent 65%); }
  .studio-ambience[data-backdrop="mesh"] { background: radial-gradient(at 0% 30%, hsl(var(--theme)), transparent 60%), radial-gradient(at 100% 80%, hsl(var(--ring)), transparent 60%); }
</style>
