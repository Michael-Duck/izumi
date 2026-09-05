<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation'
  import { openThemeStudio } from '$lib/settings/theme-studio-session'

  // Theme Studio edits the real client. The shell keeps the editor alive on every app page.
  afterNavigate(() => {
    openThemeStudio()
    void goto('/app/home', { replaceState: true })
  })
</script>

<svelte:head><title>Theme Studio · izumi</title></svelte:head>
<p class="p-8 text-sm text-muted-foreground" role="status">Opening Theme Studio in your client…</p>
