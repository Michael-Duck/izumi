<script lang="ts">
  import { tick } from 'svelte'
  import { goto } from '$app/navigation'
  import Check from '@lucide/svelte/icons/check'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import Settings from '@lucide/svelte/icons/settings'
  import X from '@lucide/svelte/icons/x'
  import {
    activateProfile,
    activeProfile,
    activeProfileId,
    activeProfileLocked,
    profiles,
    profileSwitcherOpen,
    unlockActiveProfile,
    type IzumiProfile,
  } from '$lib/profiles/store'

  let pending = $state<IzumiProfile | null>(null)
  let pin = $state('')
  let error = $state('')
  let busy = $state(false)
  let pinInput = $state<HTMLInputElement>()

  const visible = $derived($profileSwitcherOpen || $activeProfileLocked)
  const title = $derived($activeProfileLocked ? `Unlock ${$activeProfile.name}` : 'Who’s watching?')

  $effect(() => {
    if (!visible) {
      pending = null
      pin = ''
      error = ''
    } else if ($activeProfileLocked) {
      pending = $activeProfile
      void tick().then(() => pinInput?.focus())
    }
  })

  async function choose(profile: IzumiProfile) {
    error = ''
    if (profile.id === $activeProfileId && !$activeProfileLocked) {
      $profileSwitcherOpen = false
      return
    }
    if (profile.pin) {
      pending = profile
      pin = ''
      await tick()
      pinInput?.focus()
      return
    }
    busy = true
    await activateProfile(profile.id)
    busy = false
  }

  async function submitPin() {
    if (!pending || busy) return
    busy = true
    error = ''
    const ok = pending.id === $activeProfileId
      ? await unlockActiveProfile(pin)
      : await activateProfile(pending.id, pin)
    busy = false
    if (!ok) {
      error = 'That PIN did not match.'
      pin = ''
      await tick()
      pinInput?.focus()
    } else if (pending.id === $activeProfileId) {
      $profileSwitcherOpen = false
      pending = null
    }
  }

  function close() {
    if ($activeProfileLocked) return
    $profileSwitcherOpen = false
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close()
  }

  function manage() {
    $profileSwitcherOpen = false
    void goto('/app/settings/profiles')
  }
</script>

<svelte:window onkeydown={keydown} />

{#if visible}
  <div class="fixed inset-0 z-[90] grid place-items-center bg-background/88 p-4 backdrop-blur-xl" role="presentation">
    <div
      data-nav-trap
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-switcher-title"
      class="relative w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-card/95 px-5 pb-6 pt-8 shadow-2xl sm:px-9 sm:pb-9"
    >
      {#if !$activeProfileLocked}
        <button type="button" data-focusable onclick={close} aria-label="Close profile switcher" class="absolute right-4 top-4 grid size-10 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-95"><X size={20} /></button>
      {/if}
      <div class="mx-auto max-w-xl text-center">
        <p class="text-xs font-bold tracking-[0.18em] text-theme">IZUMI PROFILES</p>
        <h1 id="profile-switcher-title" class="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
        <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {$activeProfileLocked ? 'Enter the profile PIN before browsing or playing anything.' : 'History, watchlists, recommendations and connected accounts stay separate.'}
        </p>
      </div>

      {#if pending?.pin}
        <form onsubmit={(event) => { event.preventDefault(); void submitPin() }} class="mx-auto mt-7 max-w-sm">
          <div class="mb-3 flex items-center justify-center gap-2 text-sm font-bold"><LockKeyhole size={17} class="text-theme" /> {pending.name}</div>
          <label for="profile-pin" class="sr-only">Profile PIN</label>
          <input
            id="profile-pin"
            bind:this={pinInput}
            bind:value={pin}
            data-focusable
            inputmode="numeric"
            pattern="[0-9]*"
            minlength="4"
            maxlength="6"
            autocomplete="off"
            placeholder="Enter 4–6 digit PIN"
            class="h-14 w-full rounded-xl bg-input px-4 text-center font-mono text-xl tracking-[0.28em] outline-none ring-theme focus:ring-2"
          />
          {#if error}<p role="alert" class="mt-2 text-center text-sm text-destructive">{error}</p>{/if}
          <div class="mt-4 grid grid-cols-2 gap-2">
            {#if !$activeProfileLocked}<button type="button" data-focusable onclick={() => { pending = null; pin = ''; error = '' }} class="min-h-11 rounded-xl bg-secondary font-bold transition hover:bg-accent">Back</button>{/if}
            <button type="submit" data-focusable disabled={pin.length < 4 || busy} class="min-h-11 rounded-xl bg-primary font-black text-primary-foreground transition active:scale-[0.98] disabled:opacity-40 {$activeProfileLocked ? 'col-span-2' : ''}">{busy ? 'Checking…' : 'Unlock'}</button>
          </div>
        </form>
      {:else}
        <div class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {#each $profiles as profile (profile.id)}
            <button type="button" data-focusable disabled={busy} onclick={() => choose(profile)} class="group relative flex min-w-0 flex-col items-center rounded-2xl px-2 py-4 transition hover:bg-secondary/70 active:scale-[0.98]">
              <span class="relative grid aspect-square w-full max-w-28 place-items-center rounded-[1.6rem] text-4xl font-black text-white shadow-lg transition duration-200 group-hover:-translate-y-1" style={`background:${profile.color}`}>
                {profile.name.trim().charAt(0).toUpperCase()}
                {#if profile.pin}<LockKeyhole size={16} class="absolute right-2 top-2 opacity-80" />{/if}
                {#if profile.id === $activeProfileId}<span class="absolute -bottom-2 -right-2 grid size-7 place-items-center rounded-full bg-theme text-white ring-4 ring-card"><Check size={15} strokeWidth={3} /></span>{/if}
              </span>
              <span class="mt-3 max-w-full truncate text-sm font-bold">{profile.name}</span>
              <span class="mt-0.5 text-[0.68rem] text-muted-foreground">Up to {profile.ratingLimit}{profile.allowAdult ? ' · adult enabled' : ''}</span>
            </button>
          {/each}
        </div>
        <div class="mt-7 flex justify-center">
          <button type="button" data-focusable onclick={manage} class="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground"><Settings size={16} /> Manage profiles</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
