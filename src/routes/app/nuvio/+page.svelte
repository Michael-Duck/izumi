<script lang="ts">
  import { page } from '$app/state'
  import NuvioBrowser from '$lib/components/catalog/NuvioBrowser.svelte'
</script>

<NuvioBrowser initialTab={page.url.searchParams.get('tab') ?? 'community'} targetCollection={page.url.searchParams.get('collection') ?? ''} targetFolder={page.url.searchParams.get('folder') ?? ''} />
