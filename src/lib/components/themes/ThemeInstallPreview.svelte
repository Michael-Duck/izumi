<script lang="ts">
  import { goto } from '$app/navigation'
  import { themeInstallPreview, cancelThemePreview, installTheme, applyInstalledTheme } from '$lib/themes/installed'
  let error = $state('')
  function apply() {
    const prepared = $themeInstallPreview
    if (!prepared) return
    try { applyInstalledTheme(installTheme(prepared)); cancelThemePreview() }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not install this theme.' }
  }
  function cancel() { cancelThemePreview(); void goto('/app/settings/themes') }
</script>
{#if $themeInstallPreview}
  <aside class="theme-preview-bar" aria-label="Theme installation preview">
    <div><strong>Previewing {$themeInstallPreview.package.name}</strong><p>Your saved appearance is unchanged.</p>{#if error}<p role="alert">{error}</p>{/if}</div>
    <div class="actions"><button type="button" data-focusable onclick={cancel}>Cancel preview</button><button type="button" data-focusable class="apply" onclick={apply}>Install & apply</button></div>
  </aside>
{/if}
<style>
  .theme-preview-bar { position: fixed; z-index: 70; bottom: calc(1rem + env(safe-area-inset-bottom)); left: max(1rem, 5vw); right: max(1rem, 5vw); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border: 1px solid #555560; border-radius: 12px; background: #18181f; color: #fafafa; font: 14px system-ui, sans-serif; box-shadow: 0 8px 32px #0005; }
  p { color: #c8c8d2; font-size: 12px; margin-top: 4px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button { min-height: 44px; padding: 10px 16px; border-radius: 8px; font-weight: 700; background: #303039; }
  button.apply { background: #eeeeF4; color: #18181f; }
  button:focus-visible { outline: 3px solid #ff9fb9; outline-offset: 3px; }
  @media(max-width: 640px) { .theme-preview-bar { bottom: calc(5rem + env(safe-area-inset-bottom)); } }
</style>
