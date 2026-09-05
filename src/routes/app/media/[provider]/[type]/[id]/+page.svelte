<script lang="ts">
  import { page } from '$app/state'
  import CatalogMediaDetail from '$lib/components/catalog/CatalogMediaDetail.svelte'
  import AnimeDetail from '$lib/components/detail/AnimeDetail.svelte'
  import CatalogAnimeDetail from '$lib/components/detail/CatalogAnimeDetail.svelte'
  import { usesAnimeDetail } from '$lib/catalog/anime-detail'
  import type { CatalogContentType, CatalogProviderId } from '$lib/catalog/identity'

  const provider = $derived(page.params.provider as CatalogProviderId)
  const type = $derived(page.params.type as CatalogContentType)
  const id = $derived(page.params.id ?? '')
  const ref = $derived({ provider, type, id })
</script>

{#key `${provider}:${type}:${id}`}
  {#if usesAnimeDetail(ref)}
    {#if provider === 'anilist'}<AnimeDetail id={Number(id)} />
    {:else}<CatalogAnimeDetail {ref} />{/if}
  {:else}
    <CatalogMediaDetail {provider} {type} {id} />
  {/if}
{/key}
