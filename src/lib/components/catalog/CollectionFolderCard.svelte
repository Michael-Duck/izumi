<script lang="ts">
  import { onMount } from 'svelte'
  import { collectionFolderHref, type CollectionFolder } from '$lib/catalog/collections/model'
  let { collectionId, folder }: { collectionId: string; folder: CollectionFolder } = $props()
  let focused = $state(false)
  let reducedMotion = $state(false)
  let failed = $state<string[]>([])
  const cover = $derived(focused && !reducedMotion && folder.focusGifEnabled && folder.focusGifUrl && !failed.includes(folder.focusGifUrl)
    ? folder.focusGifUrl : folder.coverImageUrl)
  onMount(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => reducedMotion = query.matches
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  })
</script>

<a href={collectionFolderHref(collectionId, folder.id)} data-focusable aria-label={folder.title}
  onpointerenter={() => focused = true} onpointerleave={() => focused = false}
  onfocus={() => focused = true} onblur={() => focused = false}
  class="group relative block shrink-0 self-start overflow-hidden rounded-xl bg-secondary ring-1 ring-border transition hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary {folder.tileShape === 'landscape' ? 'aspect-video w-64 sm:w-80' : folder.tileShape === 'square' ? 'aspect-square w-40 sm:w-48' : 'aspect-[2/3] w-36 sm:w-44'}">
  {#if cover && !failed.includes(cover)}
    <img src={cover} alt="" loading="lazy" referrerpolicy="no-referrer" class="size-full object-cover" onerror={() => failed = [...failed, cover!]} />
  {:else}
    <span class="absolute inset-0 grid place-items-center p-4 text-center text-lg font-bold">{folder.coverEmoji || folder.title}</span>
  {/if}
  {#if !folder.hideTitle && ((cover && !failed.includes(cover)) || folder.coverEmoji)}
    <span class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 text-sm font-bold text-white">{folder.title}</span>
  {/if}
</a>
