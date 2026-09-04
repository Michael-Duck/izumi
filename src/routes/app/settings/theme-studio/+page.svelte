<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import Palette from '@lucide/svelte/icons/palette'
  import Save from '@lucide/svelte/icons/save'
  import Copy from '@lucide/svelte/icons/copy'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import Download from '@lucide/svelte/icons/download'
  import Upload from '@lucide/svelte/icons/upload'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Check from '@lucide/svelte/icons/check'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
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
    const selected = $studioThemes.find((theme) => theme.id === id)
    if (!selected) return
    $activeStudioThemeId = id
    draft = clone(selected)
    notice = ''
  }

  function saveAndApply() {
    const saved = saveStudioTheme(clone(draft))
    draft = clone(saved)
    $themePreset = 'custom'
    notice = `${saved.name} saved and applied.`
  }

  function makeCopy() {
    const copy = duplicateStudioTheme(clone(draft))
    draft = clone(copy)
    notice = 'Created a separate editable copy.'
  }

  function removeCurrent() {
    const remaining = $studioThemes.filter((theme) => theme.id !== draft.id)
    if (!deleteStudioTheme(draft.id)) {
      notice = 'Keep at least one saved theme.'
      return
    }
    draft = clone(remaining[0] ?? defaultStudioTheme())
    $activeStudioThemeId = draft.id
    notice = 'Theme deleted.'
  }

  function discardChanges() {
    draft = clone(get(activeStudioTheme))
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
    try {
      const imported = parseStudioTheme(await file.text())
      $studioThemes = [...$studioThemes, imported]
      $activeStudioThemeId = imported.id
      draft = clone(imported)
      notice = `${imported.name} loaded. Review it, then Save & Apply.`
    } catch (error) {
      notice = ioErrorMessage(error, 'Invalid theme file.')
    }
  }
</script>

<svelte:head><title>Theme Studio · izumi</title></svelte:head>

<div class="p-4 pb-24 sm:p-8">
  <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <div class="mb-1 flex items-center gap-2 text-theme"><Palette size={18} /><span class="text-[11px] font-black uppercase tracking-[0.2em]">Theme Studio</span></div>
      <h2 class="text-3xl font-black tracking-tight">Make Izumi yours.</h2>
      <p class="mt-1 max-w-2xl text-sm text-muted-foreground">Every change previews across the whole app. Nothing replaces the active theme until you save.</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button data-focusable onclick={discardChanges} class="inline-flex min-h-10 items-center gap-2 rounded-xl bg-secondary px-4 text-sm font-black"><RotateCcw size={16} /> Discard</button>
      <button data-focusable onclick={saveAndApply} class="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground"><Save size={16} /> Save &amp; Apply</button>
    </div>
  </header>

  {#if notice}<div role="status" class="mb-5 rounded-xl border border-theme/25 bg-theme/10 px-4 py-3 text-sm font-bold">{notice}</div>{/if}

  <div class="grid items-start gap-6 xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
    <aside class="space-y-5 xl:sticky xl:top-8">
      <section>
        <div class="mb-2 flex items-center justify-between"><h3 class="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Saved themes</h3><span class="text-xs text-muted-foreground">{$studioThemes.length}/24</span></div>
        <div class="space-y-2">
          {#each $studioThemes as theme (theme.id)}
            <button data-focusable onclick={() => selectTheme(theme.id)} aria-pressed={theme.id === draft.id}
              class="flex min-h-14 w-full items-center gap-3 rounded-xl border p-2.5 text-left transition {theme.id === draft.id ? 'border-theme bg-theme/10' : 'border-border bg-card hover:bg-secondary'}">
              <span class="grid grid-cols-2 overflow-hidden rounded-lg border border-black/20">
                <span class="size-5" style={`background:${hslTokenToHex(theme.tokens.background)}`}></span><span class="size-5" style={`background:${hslTokenToHex(theme.tokens.theme)}`}></span>
                <span class="size-5" style={`background:${hslTokenToHex(theme.tokens.card)}`}></span><span class="size-5" style={`background:${hslTokenToHex(theme.tokens.foreground)}`}></span>
              </span>
              <span class="min-w-0 flex-1"><span class="block truncate text-sm font-black">{theme.name}</span><span class="block text-[10px] capitalize text-muted-foreground">{theme.tokens.scheme} · {theme.font}</span></span>
              {#if theme.id === $activeStudioThemeId}<Check size={15} class="text-theme" />{/if}
            </button>
          {/each}
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button data-focusable onclick={makeCopy} class="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-secondary text-xs font-black"><Copy size={14} /> Duplicate</button>
          <button data-focusable onclick={removeCurrent} disabled={$studioThemes.length <= 1} class="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl text-xs font-black text-destructive hover:bg-destructive/10 disabled:opacity-35"><Trash2 size={14} /> Delete</button>
        </div>
      </section>

      <section class="rounded-2xl border border-border bg-card p-4">
        <h3 class="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Portable theme</h3>
        <p class="mt-2 text-xs leading-5 text-muted-foreground">Theme files contain visual tokens only—never accounts or history.</p>
        <div class="mt-3 grid gap-2">
          <button data-focusable onclick={exportTheme} class="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-secondary text-xs font-black"><Download size={15} /> Export JSON</button>
          <button data-focusable onclick={() => importInput?.click()} class="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-secondary text-xs font-black"><Upload size={15} /> Import JSON</button>
          <input bind:this={importInput} onchange={importTheme} type="file" accept="application/json,.json,.izumi-theme.json" class="hidden" />
        </div>
      </section>
    </aside>

    <div class="space-y-6">
      <section class="rounded-2xl border border-border bg-card p-5">
        <div class="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label><span class="mb-1.5 block text-xs font-black uppercase tracking-wide text-muted-foreground">Theme name</span><input bind:value={draft.name} maxlength="48" data-focusable class="h-11 w-full rounded-xl border border-border bg-input px-3 text-sm font-bold" /></label>
          <div class="flex rounded-xl bg-secondary p-1">
            {#each ['dark', 'light'] as scheme}
              <button data-focusable onclick={() => (draft.tokens.scheme = scheme as 'dark' | 'light')} aria-pressed={draft.tokens.scheme === scheme}
                class="min-h-9 rounded-lg px-4 text-xs font-black capitalize {draft.tokens.scheme === scheme ? 'bg-background shadow-sm' : 'text-muted-foreground'}">{scheme}</button>
            {/each}
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-border bg-card p-5">
        <h3 class="font-black">Palette starters</h3><p class="mt-1 text-xs text-muted-foreground">Load a complete accessible base, then tune individual tokens below.</p>
        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {#each paletteStarters as starter}
            <button data-focusable onclick={() => applyStarter(starter.id)} class="rounded-xl border border-border bg-secondary/40 p-2 text-left hover:border-theme/50">
              <span class="mb-2 flex h-9 overflow-hidden rounded-lg"><span class="flex-1" style={`background:hsl(${THEME_PRESETS[starter.id].background})`}></span><span class="flex-1" style={`background:hsl(${THEME_PRESETS[starter.id].card})`}></span><span class="flex-1" style={`background:hsl(${THEME_PRESETS[starter.id].theme})`}></span></span>
              <span class="text-xs font-black">{starter.label}</span>
            </button>
          {/each}
        </div>
      </section>

      {#each colorGroups as group (group.label)}
        <section class="rounded-2xl border border-border bg-card p-5">
          <h3 class="font-black">{group.label}</h3>
          <div class="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {#each group.items as item (item.key)}
              <label class="flex items-center gap-3">
                <input type="color" value={hslTokenToHex(draft.tokens[item.key])} oninput={(event) => updateColor(item.key, event)} data-focusable aria-label={item.label}
                  class="h-11 w-14 cursor-pointer rounded-xl border border-border bg-transparent p-1" />
                <span class="min-w-0"><span class="block text-sm font-bold">{item.label}</span><span class="block truncate font-mono text-[10px] text-muted-foreground">{draft.tokens[item.key]}</span></span>
              </label>
            {/each}
          </div>
        </section>
      {/each}

      <section class="rounded-2xl border border-border bg-card p-5">
        <h3 class="font-black">Type &amp; shape</h3>
        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          {#each fonts as font}
            <button data-focusable onclick={() => (draft.font = font.id)} aria-pressed={draft.font === font.id}
              class="rounded-xl border p-3 text-left {draft.font === font.id ? 'border-theme bg-theme/10' : 'border-border bg-secondary/35'}">
              <span class="block text-sm font-black">{font.label}</span><span class="mt-1 block text-xs text-muted-foreground">{font.sample}</span>
            </button>
          {/each}
        </div>
        <div class="mt-5 grid gap-5 sm:grid-cols-2">
          <label><span class="flex justify-between text-xs font-bold"><span>Type &amp; UI scale</span><span>{Math.round(draft.fontScale * 100)}%</span></span><input bind:value={draft.fontScale} type="range" min="0.85" max="1.2" step="0.01" data-focusable class="mt-2 w-full accent-[hsl(var(--theme))]" /></label>
          <label><span class="flex justify-between text-xs font-bold"><span>Corner radius</span><span>{draft.radius.toFixed(2)}rem</span></span><input bind:value={draft.radius} type="range" min="0" max="2" step="0.05" data-focusable class="mt-2 w-full accent-[hsl(var(--theme))]" /></label>
        </div>
      </section>

      <section class="rounded-2xl border border-border bg-card p-5">
        <h3 class="font-black">Ambient backdrop</h3>
        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {#each backdrops as backdrop}
            <button data-focusable onclick={() => (draft.backdrop = backdrop.id)} aria-pressed={draft.backdrop === backdrop.id}
              class="min-h-11 rounded-xl border text-xs font-black {draft.backdrop === backdrop.id ? 'border-theme bg-theme/10' : 'border-border bg-secondary/35'}">{backdrop.label}</button>
          {/each}
        </div>
        <div class="mt-5 grid gap-5 sm:grid-cols-2">
          <label><span class="flex justify-between text-xs font-bold"><span>Strength</span><span>{Math.round(draft.backdropStrength * 100)}%</span></span><input bind:value={draft.backdropStrength} type="range" min="0" max="0.65" step="0.01" data-focusable class="mt-2 w-full accent-[hsl(var(--theme))]" /></label>
          <label><span class="flex justify-between text-xs font-bold"><span>Mesh softness</span><span>{draft.glassBlur}px</span></span><input bind:value={draft.glassBlur} type="range" min="0" max="40" step="1" data-focusable class="mt-2 w-full accent-[hsl(var(--theme))]" /></label>
        </div>
      </section>
    </div>

    <aside class="space-y-5 xl:sticky xl:top-8">
      <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <div class="relative h-40 overflow-hidden bg-background p-5">
          <div class="absolute -right-8 -top-12 size-40 rounded-full bg-theme/25 blur-3xl"></div>
          <span class="relative text-[10px] font-black uppercase tracking-[0.18em] text-theme">Live preview</span>
          <h3 class="relative mt-3 text-2xl font-black">The cinema, remixed.</h3>
          <p class="relative mt-2 text-xs text-muted-foreground">Semantic tokens keep every surface consistent.</p>
        </div>
        <div class="border-t border-border p-4">
          <div class="flex gap-2"><button class="rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground">Primary</button><button class="rounded-lg bg-secondary px-3 py-2 text-xs font-black text-secondary-foreground">Secondary</button></div>
          <div class="mt-3 rounded-xl bg-muted p-3"><p class="text-xs font-bold">Surface sample</p><p class="mt-1 text-[10px] text-muted-foreground">Muted copy and border contrast.</p></div>
        </div>
      </section>

      <section class="rounded-2xl border border-border bg-card p-4">
        <div class="flex items-center justify-between gap-3"><h3 class="font-black">Contrast check</h3>{#if contrastPasses}<span class="inline-flex items-center gap-1 text-xs font-black text-emerald-500"><Check size={14} /> AA</span>{:else}<span class="inline-flex items-center gap-1 text-xs font-black text-amber-500"><TriangleAlert size={14} /> Review</span>{/if}</div>
        <div class="mt-3 space-y-2">
          {#each contrasts as contrast}
            <div class="flex items-center justify-between rounded-lg bg-secondary/45 px-3 py-2 text-xs"><span>{contrast.label}</span><span class="font-mono font-black {contrast.value >= 4.5 ? 'text-emerald-500' : 'text-amber-500'}">{contrast.value.toFixed(2)}:1</span></div>
          {/each}
        </div>
        <p class="mt-3 text-[10px] leading-4 text-muted-foreground">WCAG AA asks for at least 4.5:1 on normal text. Saving remains available for intentionally low-contrast art themes.</p>
      </section>

      <button data-focusable onclick={resetDesign} class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-black hover:bg-secondary"><RotateCcw size={16} /> Reset design controls</button>
    </aside>
  </div>
</div>
