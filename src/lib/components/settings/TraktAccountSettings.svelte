<script lang="ts">
  import { onDestroy } from 'svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import SettingsGroup from './SettingsGroup.svelte'
  import SettingsRow from './SettingsRow.svelte'
  import {
    traktClientId,
    traktClientSecret,
    traktRedirectUri,
    traktToken,
    traktUserName,
    traktUserSlug,
  } from '$lib/trakt/config'
  import type { TraktDeviceCode } from '$lib/trakt/types'

  let formOpen = $state(false)
  let clientIdInput = $state($traktClientId)
  let clientSecretInput = $state($traktClientSecret)
  let redirectUriInput = $state($traktRedirectUri)
  let busy = $state(false)
  let error = $state('')
  let deviceCode = $state<TraktDeviceCode | null>(null)
  let controller: AbortController | null = null

  onDestroy(() => controller?.abort())

  function saveCredentials() {
    $traktClientId = clientIdInput.trim()
    $traktClientSecret = clientSecretInput.trim()
    $traktRedirectUri = redirectUriInput.trim()
  }

  async function connect() {
    if (busy) return
    saveCredentials()
    error = ''
    deviceCode = null
    busy = true
    controller = new AbortController()
    try {
      const { connectTrakt } = await import('$lib/trakt/auth')
      await connectTrakt((code) => { deviceCode = code }, controller.signal)
      formOpen = false
      deviceCode = null
    } catch (cause) {
      if ((cause as { name?: string })?.name !== 'AbortError') {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      busy = false
      controller = null
    }
  }

  function cancel() {
    controller?.abort()
    busy = false
    deviceCode = null
  }

  async function disconnect() {
    if (busy) return
    busy = true
    error = ''
    try {
      const { disconnectTrakt } = await import('$lib/trakt/auth')
      await disconnectTrakt()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function openProfile() {
    if ($traktUserSlug) void openUrl(`https://trakt.tv/users/${encodeURIComponent($traktUserSlug)}`)
  }
</script>

{#snippet leading()}
  <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-[#ed1c24] text-[11px] font-black tracking-[-0.04em] text-white" aria-hidden="true">TRAKT</span>
{/snippet}
{#snippet meta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$traktToken ? 'bg-emerald-400' : busy ? 'bg-amber-400' : 'bg-white/25'}"></span>
    <span class="truncate">
      {$traktToken ? `Connected${$traktUserName ? ` as ${$traktUserName}` : ''}` : busy ? 'Waiting for browser approval' : 'Not connected · device code'}
    </span>
  </span>
{/snippet}
{#snippet control()}
  <button
    type="button"
    data-focusable
    aria-expanded={formOpen}
    onclick={() => (formOpen = !formOpen)}
    disabled={busy}
    class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40"
  >{formOpen ? 'Close' : $traktToken ? 'Manage' : 'Set up'}</button>
{/snippet}

<SettingsGroup
  icon={KeyRound}
  title="Trakt account"
  desc="Native history, Watchlist, rating sync, and a dedicated recommendation hub for this Izumi profile."
>
  <SettingsRow
    settingKey="trakt-account"
    title="Trakt"
    leading={leading}
    meta={meta}
    control={control}
    expanded={formOpen || Boolean(error) || Boolean(deviceCode)}
  >
    {#if $traktToken}
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-[11px] leading-5 text-muted-foreground">Watches, Watchlist changes, and 1–10 ratings are mirrored automatically. Pending writes retry when Trakt is reachable again.</p>
        <div class="flex shrink-0 justify-end gap-2">
          {#if $traktUserSlug}<button type="button" data-focusable onclick={openProfile} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Open profile</button>{/if}
          <a href="/app/trakt" data-focusable class="inline-flex min-h-9 items-center rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Open Trakt hub</a>
          <button type="button" data-focusable onclick={disconnect} disabled={busy} class="min-h-9 rounded-md px-3 text-xs font-bold text-destructive hover:bg-destructive/10 disabled:opacity-40">Disconnect</button>
        </div>
      </div>
    {:else}
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="grid gap-1 text-[11px] font-bold text-muted-foreground">
          Client ID
          <input bind:value={clientIdInput} autocomplete="off" data-focusable placeholder="From Trakt app settings" class="h-10 min-w-0 rounded-md bg-input px-3 text-base text-foreground sm:text-sm" />
        </label>
        <label class="grid gap-1 text-[11px] font-bold text-muted-foreground">
          Client secret
          <input bind:value={clientSecretInput} autocomplete="off" type="password" data-focusable placeholder="Stored only in this profile" class="h-10 min-w-0 rounded-md bg-input px-3 text-base text-foreground sm:text-sm" />
        </label>
        <label class="grid gap-1 text-[11px] font-bold text-muted-foreground sm:col-span-2">
          Redirect URI
          <input bind:value={redirectUriInput} autocomplete="url" inputmode="url" data-focusable placeholder="Exactly as registered with Trakt" class="h-10 min-w-0 rounded-md bg-input px-3 text-base text-foreground sm:text-sm" />
        </label>
      </div>

      {#if deviceCode}
        <div class="mt-3 rounded-lg bg-secondary/70 px-3 py-3" aria-live="polite">
          <p class="text-[11px] text-muted-foreground">The Trakt activation page is open. Enter:</p>
          <strong class="mt-1 block font-mono text-xl tracking-[0.18em]">{deviceCode.userCode}</strong>
        </div>
      {/if}

      <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span class="inline-flex max-w-md items-start gap-1.5 text-[11px] leading-4 text-muted-foreground"><ShieldCheck size={13} class="mt-0.5 shrink-0" aria-hidden="true" />Trakt requires the app secret for device auth. Izumi keeps it on this device, inside the active profile, and never includes it in profile sync.</span>
        <div class="flex shrink-0 justify-end gap-2">
          <button type="button" data-focusable onclick={() => openUrl('https://app.trakt.tv/settings/apps')} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Trakt app settings</button>
          {#if busy}
            <button type="button" data-focusable onclick={cancel} class="min-h-9 rounded-md px-3 text-xs font-bold text-destructive hover:bg-destructive/10">Cancel</button>
          {:else}
            <button type="button" data-focusable onclick={connect} disabled={!clientIdInput.trim() || !clientSecretInput.trim() || !redirectUriInput.trim()} class="min-h-9 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40">Connect</button>
          {/if}
        </div>
      </div>
    {/if}
    {#if error}<p role="alert" class="mt-2 text-xs text-destructive">{error}</p>{/if}
  </SettingsRow>
</SettingsGroup>
