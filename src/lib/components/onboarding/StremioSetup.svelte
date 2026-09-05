<script lang="ts">
  import { tick } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { m } from '$lib/paraglide/messages.js'
  import { connectStremio, stremioAccountEmail, stremioAuthKey } from '$lib/stremio/account'
  import { resetStremioAddonSync, stremioAddonSyncState, syncStremioAddons } from '$lib/stremio/account-sync'

  let { busy = $bindable(false) }: { busy?: boolean } = $props()
  let email = $state('')
  let password = $state('')
  let error = $state('')
  let panel = $state<HTMLDivElement>()
  const syncing = $derived($stremioAddonSyncState.state === 'syncing')
  const syncError = $derived($stremioAddonSyncState.state === 'error' ? $stremioAddonSyncState.message : '')

  async function connect() {
    if (busy || syncing) return
    busy = true
    error = ''
    const submittedPassword = password
    password = ''
    try {
      await connectStremio(email, submittedPassword)
      resetStremioAddonSync()
      await syncStremioAddons()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.onboarding_stremio_sync_error()
    } finally {
      busy = false
      await tick()
      panel?.focus({ preventScroll: true })
    }
  }

  async function retrySync() {
    if (busy || syncing) return
    busy = true
    error = ''
    try {
      await syncStremioAddons()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.onboarding_stremio_sync_error()
    } finally {
      busy = false
      await tick()
      panel?.focus({ preventScroll: true })
    }
  }
</script>

<div bind:this={panel} tabindex="-1" class="stremio-setup mt-7">
  {#if $stremioAuthKey}
    <div class="border-y border-border py-5" role="status" aria-live="polite">
      <div class="flex items-center gap-3">
        {#if syncing}<RefreshCw size={21} class="sync-icon shrink-0" />{:else}<Check size={21} class="shrink-0" />{/if}
        <div class="min-w-0">
          <p class="font-semibold">{m.onboarding_stremio_connected()}</p>
          <p class="mt-1 break-all text-sm text-muted-foreground">{$stremioAccountEmail}</p>
        </div>
      </div>
      <p class="mt-4 text-sm leading-relaxed text-muted-foreground">
        {#if syncing}{m.onboarding_stremio_syncing()}
        {:else if $stremioAddonSyncState.state === 'synced'}
          {#if $stremioAddonSyncState.count > 0}
            {m.onboarding_stremio_synced({ count: String($stremioAddonSyncState.count) })}
          {:else}{m.onboarding_stremio_empty()}{/if}
        {:else}{m.onboarding_stremio_sync_pending()}{/if}
      </p>
    </div>
    {#if $stremioAddonSyncState.state !== 'synced'}
      <button type="button" data-focusable class="sync-button mt-4 bg-secondary" onclick={retrySync} disabled={busy || syncing}>
        <RefreshCw size={16} />{syncing ? m.onboarding_stremio_syncing() : m.onboarding_stremio_retry()}
      </button>
    {/if}
  {:else}
    <form onsubmit={(event) => { event.preventDefault(); void connect() }} aria-busy={busy} class="grid gap-4">
      <label class="grid gap-2 text-sm font-semibold" for="setup-stremio-email">
        {m.onboarding_stremio_email()}
        <input id="setup-stremio-email" data-focusable bind:value={email} type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required disabled={busy} />
      </label>
      <label class="grid gap-2 text-sm font-semibold" for="setup-stremio-password">
        {m.onboarding_stremio_password()}
        <input id="setup-stremio-password" data-focusable bind:value={password} type="password" autocomplete="current-password" required disabled={busy} />
      </label>
      <p class="text-xs leading-relaxed text-muted-foreground">{m.onboarding_stremio_credentials_hint()}</p>
      <button type="submit" data-focusable class="sync-button bg-foreground text-background" disabled={busy || syncing || !email.trim() || !password}>
        {#if busy}<RefreshCw size={16} class="sync-icon" />{/if}
        {busy ? m.onboarding_stremio_signing_in() : m.onboarding_stremio_sign_in()}
      </button>
      <span role="status" aria-live="polite" class="sr-only">{busy ? m.onboarding_stremio_signing_in() : ''}</span>
    </form>
  {/if}
  {#if error || syncError}<p role="alert" class="mt-4 text-sm leading-relaxed text-red-400">{error || syncError}</p>{/if}
  <p class="mt-5 text-xs leading-relaxed text-muted-foreground">{$stremioAuthKey ? m.onboarding_stremio_connected_hint() : m.onboarding_stremio_optional_hint()}</p>
</div>

<style>
  .stremio-setup:focus { outline: none; box-shadow: none; }
  input { width: 100%; min-width: 0; min-height: 3rem; border: 1px solid hsl(var(--border)); border-radius: .5rem; background: hsl(var(--input)); padding: .65rem .85rem; font-size: 16px; font-weight: 400; }
  .sync-button { display: inline-flex; align-items: center; justify-content: center; gap: .6rem; min-height: 3rem; padding: .75rem 1rem; border-radius: .5rem; font-size: .95rem; font-weight: 700; transition: opacity 180ms, transform 180ms; }
  .sync-button:hover:not(:disabled) { opacity: .85; }
  .sync-button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled, input:disabled { opacity: .55; cursor: wait; }
  button:focus-visible, input:focus-visible { outline: 2px solid hsl(var(--foreground)); outline-offset: 3px; }
  .stremio-setup :global(.sync-icon) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .stremio-setup :global(.sync-icon) { animation: none; } .sync-button { transition: none; } }
</style>
