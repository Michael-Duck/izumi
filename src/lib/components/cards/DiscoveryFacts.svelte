<script lang="ts">
  let { facts }: { facts: string[] } = $props()
</script>

{#if facts.length}
  <ul class="discovery-facts" aria-label="Title information">
    {#each facts as fact, index}
      <li>{#if index > 0}<span class="separator" aria-hidden="true">·</span>{/if}<span>{fact}</span></li>
    {/each}
  </ul>
{/if}

<style>
  .discovery-facts { display: flex; flex-wrap: wrap; gap: .25rem 0; font-size: inherit; line-height: 1.6; }
  li { display: inline-flex; align-items: baseline; }
  .separator { margin-inline: .55em; opacity: .7; }
</style>
