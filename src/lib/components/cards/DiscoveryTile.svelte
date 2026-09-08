<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { cardCover, title } from '$lib/anilist/media'
  import { discoveryFacts } from '$lib/recommendations/discovery-presentation'
  import DiscoveryFacts from './DiscoveryFacts.svelte'
  import Film from '@lucide/svelte/icons/film'
  import Check from '@lucide/svelte/icons/check'

  let { media, selected, onselect }: { media: Media; selected: boolean; onselect: () => void } = $props()
  let failed = $state<string[]>([])
  const landscape = $derived(media.bannerImage && !failed.includes(media.bannerImage) ? media.bannerImage : '')
  const poster = $derived(cardCover(media, 180))
  const artwork = $derived(landscape || (poster && !failed.includes(poster) ? poster : ''))
</script>

<button type="button" data-focusable class="discovery-tile" class:selected aria-pressed={selected}
  aria-label={`Explore ${title(media)}${selected ? ', currently featured' : ''}`} onclick={onselect}>
  <span class="tile-art" class:poster={!landscape}>
    {#if artwork}
      <img src={artwork} alt="" loading="lazy" decoding="async" onerror={() => { failed = [...failed, artwork] }} />
    {:else}<Film size={28} aria-hidden="true" />{/if}
    {#if selected}<span class="selection"><Check size={13} /> Featured</span>{/if}
  </span>
  <span class="tile-title">{title(media)}</span>
  <div class="tile-facts"><DiscoveryFacts facts={discoveryFacts(media, true)} /></div>
  {#if media.genres?.length}<p class="tile-genres">{media.genres.slice(0, 2).join(' · ')}</p>{/if}
</button>

<style>
  .discovery-tile { width: 100%; min-width: 0; text-align: start; border-radius: .75rem; padding: .3rem; color: hsl(var(--foreground)); }
  .tile-art { display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; aspect-ratio: 16 / 9; border-radius: .5rem; background: hsl(var(--secondary)); color: hsl(var(--muted-foreground)); outline: 1px solid hsl(var(--border)); }
  img { height: 100%; width: 100%; object-fit: cover; transition: transform 180ms ease; }
  .poster img { object-fit: contain; }
  .selected .tile-art { outline: 2px solid hsl(var(--foreground)); outline-offset: 2px; }
  .selection { position: absolute; bottom: .5rem; left: .5rem; display: flex; align-items: center; gap: .3rem; background: #16181ded; color: #fff; border-radius: .25rem; padding: .25rem .4rem; font-size: .625rem; font-weight: 700; }
  .tile-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; margin-top: .8rem; font-size: .875rem; line-height: 1.4; font-weight: 750; }
  .tile-facts, .tile-genres { font-size: .75rem; color: hsl(var(--muted-foreground)); line-height: 1.6; margin-top: .2rem; }
  .tile-genres { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button:focus-visible { outline: 2px solid hsl(var(--foreground)); outline-offset: 3px; }
  @media (hover: hover) { button:hover img { transform: scale(1.04); } button:hover .tile-title { text-decoration: underline; text-underline-offset: .2em; } }
  @media (prefers-reduced-motion: reduce) { img { transition: none; } button:hover img { transform: none; } }
</style>
