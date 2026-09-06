<script lang="ts">
  let { children } = $props()
  const sections = [
    { label: 'Overview', href: '/docs' },
    { label: 'Companion setup', href: '/docs/companion/setup' },
    { label: 'Sources & playback', href: '/docs/companion/sources' },
    { label: 'P2P explained', href: '/docs/companion/p2p' },
    { label: 'Troubleshooting', href: '/docs/companion/troubleshooting' },
  ]
</script>

<svelte:head><title>izumi documentation</title><meta name="description" content="izumi documentation, including the Samsung Tizen Companion setup guide." /></svelte:head>

<div class="min-h-screen bg-[#0b0d12] text-[#edf0f7]">
  <header class="sticky top-0 z-20 border-b border-white/[.08] bg-[#0b0d12]/90 backdrop-blur-xl">
    <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
      <a href="/docs" class="flex items-center gap-2.5 font-black tracking-tight"><img src="/brand/izumi-mark-color.svg" alt="" class="size-7" /> izumi <span class="font-mono text-xs font-normal text-white/40">/ docs</span></a>
      <a href="/app/home" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 transition hover:border-white/25 hover:text-white">Open izumi <span aria-hidden="true">↗</span></a>
    </div>
  </header>
  <div class="mx-auto grid max-w-7xl lg:grid-cols-[230px_minmax(0,1fr)]">
    <aside class="hidden border-r border-white/[.08] px-5 py-10 lg:block">
      <p class="mb-4 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#9b8cff]">Guide</p>
      <nav class="space-y-1">
        {#each sections as item}
          <a href={item.href} class="block rounded-lg px-3 py-2.5 text-sm text-white/55 transition hover:bg-white/[.06] hover:text-white">{item.label}</a>
        {/each}
      </nav>
      <div class="mt-12 border-t border-white/[.08] pt-5 text-xs leading-5 text-white/35">izumi Companion is the Samsung Tizen client for your izumi library.</div>
    </aside>
    <main class="min-w-0 px-5 py-10 sm:px-10 lg:px-20 lg:py-16">{@render children()}</main>
  </div>
</div>
