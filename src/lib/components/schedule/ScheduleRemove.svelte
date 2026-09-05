<script lang="ts">
  import { tick } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import type { Media } from '$lib/anilist/types'
  import { title } from '$lib/anilist/media'
  import { removeFromList } from '$lib/trackers'
  import { incognito } from '$lib/stores/incognito'

  let { media }: { media: Media } = $props()

  async function remove(event: MouseEvent) {
    const row = (event.currentTarget as HTMLElement).closest('[data-schedule-item]')
    const next = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>('a[data-focusable]')
    // The local removal is synchronous; tracker delivery may finish later or enter the retry queue.
    void removeFromList(media)
    await tick()
    next?.focus({ preventScroll: true })
  }
</script>

<button type="button" data-focusable onclick={remove} disabled={$incognito}
  aria-label={`Remove ${title(media)} from My Shows`} title="Remove from My Shows and watching lists"
  class="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">
  <X size={18} />
</button>
