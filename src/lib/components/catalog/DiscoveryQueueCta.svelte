<script lang="ts">
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
</script>

<a href="/app/discovery-queue" data-focusable
  class="group mx-4 flex min-h-20 items-center gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.07] px-5 py-4 transition hover:border-primary/40 hover:bg-primary/[0.11] sm:mx-8">
  <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
    <Sparkles size={21} />
  </span>
  <span class="min-w-0 flex-1">
    <span class="block text-[11px] font-black uppercase tracking-[0.18em] text-primary">Discovery Queue</span>
    <span class="mt-0.5 block text-sm font-bold text-foreground sm:text-base">Swipe through movies and series tuned to this profile</span>
  </span>
  <ChevronRight size={21} class="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
</a>
