<script lang="ts">
  import { homeCollections } from '$lib/catalog/collections/store'
  import { collectionFolderHref } from '$lib/catalog/collections/model'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import CollectionFolderCard from './CollectionFolderCard.svelte'
  const collections = $derived([...$homeCollections].sort((a, b) => Number(b.pinToTop) - Number(a.pinToTop)))
</script>

{#each collections as collection (collection.id)}
  {#if collection.folders.length}
    <Carousel title={collection.title} viewMoreHref={collectionFolderHref(collection.id)}>
      {#each collection.folders as folder (folder.id)}
        <CollectionFolderCard collectionId={collection.id} {folder} />
      {/each}
    </Carousel>
  {/if}
{/each}
