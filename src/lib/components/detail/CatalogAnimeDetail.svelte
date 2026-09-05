<script lang="ts">
  import AnimeDetail from './AnimeDetail.svelte'
  import { animeDetailSource } from '$lib/catalog/anime-detail'
  import { compatibilityMediaId, type MediaRef } from '$lib/catalog/identity'
  import { offlineMode } from '$lib/stores/offline'

  let { ref }: { ref: MediaRef } = $props()
  const source = $derived(animeDetailSource(ref, $offlineMode))
  const id = $derived($source.data?.Media?.id ?? compatibilityMediaId(ref))
</script>

<AnimeDetail {id} {source} />
