<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import Pencil from '@lucide/svelte/icons/pencil'
  import Plus from '@lucide/svelte/icons/plus'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import Users from '@lucide/svelte/icons/users'
  import {
    PROFILE_COLORS,
    activeProfileId,
    createProfile,
    deleteProfile,
    profiles,
    setProfilePin,
    updateProfile,
    verifyProfilePin,
    type IzumiProfile,
    type ProfileRatingLimit,
  } from '$lib/profiles/store'

  let editing = $state<IzumiProfile | null>(null)
  let creating = $state(false)
  let name = $state('')
  let color = $state<string>(PROFILE_COLORS[0])
  let ratingLimit = $state<ProfileRatingLimit>(18)
  let allowAdult = $state(false)
  let currentPin = $state('')
  let newPin = $state('')
  let confirmPin = $state('')
  let error = $state('')
  let notice = $state('')
  let busy = $state(false)

  function beginCreate() {
    editing = null
    creating = true
    name = ''
    color = PROFILE_COLORS[$profiles.length % PROFILE_COLORS.length]
    ratingLimit = 12
    allowAdult = false
    currentPin = newPin = confirmPin = error = notice = ''
  }

  function beginEdit(profile: IzumiProfile) {
    editing = profile
    creating = false
    name = profile.name
    color = profile.color
    ratingLimit = profile.ratingLimit
    allowAdult = profile.allowAdult
    currentPin = newPin = confirmPin = error = notice = ''
  }

  function cancel() {
    editing = null
    creating = false
    error = notice = ''
  }

  async function authorized(profile: IzumiProfile): Promise<boolean> {
    if (!profile.pin || profile.id === $activeProfileId) return true
    if (await verifyProfilePin(profile, currentPin)) return true
    error = 'Enter this profile’s current PIN to change it.'
    return false
  }

  async function save() {
    error = ''
    notice = ''
    const cleanName = name.trim()
    if (!cleanName) { error = 'Give the profile a name.'; return }
    if (newPin && newPin !== confirmPin) { error = 'The new PIN entries do not match.'; return }
    if (newPin && !/^\d{4,6}$/.test(newPin)) { error = 'Use a 4 to 6 digit PIN.'; return }
    busy = true
    try {
      if (creating) {
        const id = createProfile({ name: cleanName, color, ratingLimit, allowAdult })
        if (newPin) await setProfilePin(id, newPin)
        notice = `${cleanName} was created.`
      } else if (editing) {
        if (!(await authorized(editing))) return
        updateProfile(editing.id, { name: cleanName, color, ratingLimit, allowAdult })
        if (newPin) await setProfilePin(editing.id, newPin)
        notice = `${cleanName} was updated.`
      }
      editing = null
      creating = false
      currentPin = newPin = confirmPin = ''
    } finally { busy = false }
  }

  async function removePin() {
    if (!editing?.pin || !(await authorized(editing))) return
    busy = true
    await setProfilePin(editing.id, null)
    editing = { ...editing, pin: undefined }
    currentPin = ''
    notice = 'PIN removed.'
    busy = false
  }

  async function remove(profile: IzumiProfile) {
    error = ''
    if (profile.id === $activeProfileId) { error = 'Switch profiles before deleting the active one.'; return }
    busy = true
    const ok = await deleteProfile(profile.id, currentPin)
    busy = false
    if (!ok) { error = profile.pin ? 'Enter the profile PIN before deleting it.' : 'This profile cannot be deleted.'; return }
    editing = null
    currentPin = ''
    notice = `${profile.name} and its on-device profile data were deleted.`
  }
</script>

<div class="mx-auto max-w-5xl p-4 pb-24 sm:p-8">
  <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div>
      <p class="text-xs font-bold tracking-[0.16em] text-theme">HOUSEHOLD</p>
      <h2 class="mt-1 text-3xl font-black tracking-tight">Profiles</h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Each profile has separate history, progress, watchlists, recommendations and account connections. A PIN protects entry; the rating limit filters playback and adult discovery.</p>
    </div>
    <button type="button" data-focusable onclick={beginCreate} disabled={$profiles.length >= 8 || busy} class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground transition active:scale-[0.98] disabled:opacity-40"><Plus size={18} /> Add profile</button>
  </header>

  {#if notice}<p role="status" class="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>{/if}
  {#if error}<p role="alert" class="mb-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>{/if}

  <section aria-label="Household profiles" class="grid gap-3 md:grid-cols-2">
    {#each $profiles as profile (profile.id)}
      <article class="flex items-center gap-4 rounded-2xl bg-secondary/45 p-4 transition hover:bg-secondary/65">
        <div class="grid size-16 shrink-0 place-items-center rounded-2xl text-2xl font-black text-white shadow-lg" style={`background:${profile.color}`}>{profile.name.charAt(0).toUpperCase()}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2"><h3 class="truncate text-lg font-black">{profile.name}</h3>{#if profile.id === $activeProfileId}<span class="inline-flex items-center gap-1 text-[0.68rem] font-bold text-theme"><Check size={12} /> active</span>{/if}</div>
          <p class="mt-1 text-xs text-muted-foreground">Up to age {profile.ratingLimit} · {profile.allowAdult ? 'adult discovery allowed' : 'adult discovery blocked'} · {profile.pin ? 'PIN protected' : 'no PIN'}</p>
        </div>
        <button type="button" data-focusable onclick={() => beginEdit(profile)} aria-label={`Edit ${profile.name}`} class="grid size-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground"><Pencil size={17} /></button>
      </article>
    {/each}
  </section>

  {#if creating || editing}
    <section class="mt-6 overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="profile-form-title">
      <div class="border-b border-border px-5 py-4">
        <h3 id="profile-form-title" class="text-xl font-black">{creating ? 'New profile' : `Edit ${editing?.name}`}</h3>
        <p class="mt-1 text-xs text-muted-foreground">Unknown content ratings remain visible; explicit adult flags and recognised regional ratings are enforced.</p>
      </div>
      <div class="grid gap-5 p-5 lg:grid-cols-[1fr_1fr]">
        <div class="space-y-5">
          <label class="block"><span class="mb-1.5 block text-xs font-bold">Profile name</span><input bind:value={name} data-focusable maxlength="32" autocomplete="off" class="h-11 w-full rounded-xl bg-input px-3 text-base outline-none ring-theme focus:ring-2" /></label>
          <fieldset><legend class="mb-2 text-xs font-bold">Profile colour</legend><div class="flex flex-wrap gap-2">{#each PROFILE_COLORS as choice}<button type="button" data-focusable onclick={() => (color = choice)} aria-label={`Use ${choice}`} aria-pressed={color === choice} class="grid size-10 place-items-center rounded-xl transition active:scale-95" style={`background:${choice}`}>{#if color === choice}<Check size={18} class="text-white" strokeWidth={3} />{/if}</button>{/each}</div></fieldset>
          <label class="block"><span class="mb-1.5 block text-xs font-bold">Maximum content age</span><select bind:value={ratingLimit} data-focusable class="h-11 w-full rounded-xl bg-input px-3 text-sm font-bold"><option value={7}>Age 7</option><option value={12}>Age 12</option><option value={16}>Age 16</option><option value={18}>Age 18</option></select></label>
          <button type="button" data-focusable onclick={() => (allowAdult = !allowAdult)} disabled={ratingLimit !== 18} aria-pressed={allowAdult} class="flex min-h-12 w-full items-center justify-between rounded-xl bg-secondary/70 px-3 text-left disabled:opacity-40"><span><strong class="block text-sm">Adult discovery</strong><span class="text-xs text-muted-foreground">Allow explicitly marked 18+ titles.</span></span><span class="relative h-6 w-11 rounded-full {allowAdult ? 'bg-theme' : 'bg-white/20'}"><span class="absolute top-0.5 size-5 rounded-full bg-white transition-transform {allowAdult ? 'translate-x-5' : 'translate-x-0.5'}"></span></span></button>
        </div>
        <div class="space-y-4 rounded-2xl bg-secondary/35 p-4">
          <div class="flex items-center gap-2"><LockKeyhole size={18} class="text-theme" /><h4 class="font-black">Parental PIN</h4></div>
          {#if editing?.pin && editing.id !== $activeProfileId}<label class="block"><span class="mb-1 block text-xs font-bold">Current PIN</span><input bind:value={currentPin} data-focusable inputmode="numeric" maxlength="6" autocomplete="off" class="h-11 w-full rounded-xl bg-input px-3 font-mono tracking-[0.2em]" /></label>{/if}
          <label class="block"><span class="mb-1 block text-xs font-bold">{editing?.pin ? 'New PIN (leave blank to keep)' : 'PIN (optional)'}</span><input bind:value={newPin} data-focusable inputmode="numeric" maxlength="6" autocomplete="new-password" class="h-11 w-full rounded-xl bg-input px-3 font-mono tracking-[0.2em]" /></label>
          <label class="block"><span class="mb-1 block text-xs font-bold">Confirm new PIN</span><input bind:value={confirmPin} data-focusable inputmode="numeric" maxlength="6" autocomplete="new-password" class="h-11 w-full rounded-xl bg-input px-3 font-mono tracking-[0.2em]" /></label>
          {#if editing?.pin}<button type="button" data-focusable onclick={removePin} disabled={busy} class="text-sm font-bold text-destructive hover:underline">Remove PIN</button>{/if}
          <p class="text-[0.68rem] leading-5 text-muted-foreground">PINs are stored as salted SHA-256 hashes, never as readable digits. This is an on-device household gate, not disk encryption.</p>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
        <div>{#if editing && editing.id !== 'default'}<button type="button" data-focusable onclick={() => remove(editing!)} disabled={busy} class="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold text-destructive transition hover:bg-destructive/10"><Trash2 size={16} /> Delete profile</button>{/if}</div>
        <div class="flex gap-2"><button type="button" data-focusable onclick={cancel} class="min-h-10 rounded-lg px-4 text-sm font-bold hover:bg-secondary">Cancel</button><button type="button" data-focusable onclick={save} disabled={busy} class="min-h-10 rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground disabled:opacity-40">{busy ? 'Saving…' : 'Save profile'}</button></div>
      </div>
    </section>
  {:else}
    <div class="mt-6 flex items-start gap-3 rounded-2xl bg-secondary/30 p-5 text-sm text-muted-foreground"><Users size={20} class="mt-0.5 shrink-0 text-theme" /><p class="max-w-2xl leading-6">The original Main profile keeps your existing data. New profiles start empty and use isolated local-storage partitions. Switching profiles reloads the shell so background sync, trackers and playback cannot leak state across people.</p></div>
  {/if}
</div>
