<script lang="ts">
  import Image from '@lucide/svelte/icons/image'
  let { url, title, contain = false }: { url?: string; title: string; contain?: boolean } = $props()
  let failed = $state('')
</script>
{#if url && failed !== url}
  <img src={url} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => failed = url ?? ''} class="size-full {contain ? 'object-contain' : 'object-cover'}" />
{:else}
  <span class="flex size-full flex-col items-center justify-center gap-3 bg-secondary p-4 text-center text-muted-foreground"><Image class="size-8 opacity-40" /><span class="line-clamp-2 text-sm font-bold">{title}</span></span>
{/if}
