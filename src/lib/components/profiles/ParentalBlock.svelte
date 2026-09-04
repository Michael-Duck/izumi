<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import Users from '@lucide/svelte/icons/users'
  import { goto } from '$app/navigation'
  import { activeProfile, profileSwitcherOpen } from '$lib/profiles/store'

  function back() {
    if (typeof history !== 'undefined' && history.length > 1) history.back()
    else void goto('/app/home')
  }
</script>

<div class="grid min-h-[72vh] place-items-center p-6">
  <section class="w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-card/95 p-7 text-center shadow-2xl">
    <div class="mx-auto grid size-16 place-items-center rounded-2xl bg-theme/15 text-theme"><LockKeyhole size={30} /></div>
    <p class="mt-5 text-xs font-bold tracking-[0.16em] text-theme">PARENTAL CONTROLS</p>
    <h1 class="mt-2 text-2xl font-black tracking-tight">This title isn’t available for {$activeProfile.name}</h1>
    <p class="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">The title is above this profile’s age limit or is marked as adult content. Switch to an eligible profile to continue.</p>
    <div class="mt-6 grid gap-2 sm:grid-cols-2">
      <button type="button" data-focusable onclick={back} class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary font-bold transition hover:bg-accent"><ArrowLeft size={17} /> Go back</button>
      <button type="button" data-focusable onclick={() => ($profileSwitcherOpen = true)} class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary font-black text-primary-foreground transition active:scale-[0.98]"><Users size={17} /> Switch profile</button>
    </div>
  </section>
</div>
