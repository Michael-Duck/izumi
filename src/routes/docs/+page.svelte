<script lang="ts">
  const cards = [
    ['Companion setup', 'Install izumi Companion on a Samsung TV, pair it with izumi, and enable updates.', '/docs/companion/setup'],
    ['Sources & playback', 'Understand add-ons, debrid links, TV Link, and what the TV can play directly.', '/docs/companion/sources'],
    ['P2P explained', 'A plain-language guide to direct torrent playback, privacy, seeding, and device limits.', '/docs/companion/p2p'],
    ['Troubleshooting', 'Fix pairing, installation, source resolution, and updater problems.', '/docs/companion/troubleshooting'],
  ]
</script>
<div class="max-w-3xl">
  <p class="mb-5 font-mono text-xs font-bold uppercase tracking-[.22em] text-[#9b8cff]">izumi documentation</p>
  <h1 class="max-w-2xl text-4xl font-black tracking-[-.04em] sm:text-6xl">Your library, on the big screen.</h1>
  <p class="mt-6 max-w-2xl text-lg leading-8 text-white/55">Everything you need to install, pair, and understand izumi Companion — the Samsung Tizen client that brings your izumi library to your TV.</p>
  <div class="mt-10 grid gap-3 sm:grid-cols-2">
    {#each cards as [title, description, href]}
      <a href={href} class="group rounded-2xl border border-white/[.1] bg-white/[.035] p-5 transition hover:-translate-y-0.5 hover:border-[#9b8cff]/50 hover:bg-white/[.06]"><h2 class="font-bold group-hover:text-[#b7adff]">{title} <span class="float-right text-white/30">↗</span></h2><p class="mt-2 text-sm leading-6 text-white/45">{description}</p></a>
    {/each}
  </div>
  <div class="mt-14 rounded-2xl border border-[#9b8cff]/25 bg-[#9b8cff]/[.07] p-6"><p class="font-bold">New to Companion?</p><p class="mt-2 text-sm leading-6 text-white/55">Start with the <a class="text-[#c5bdff] underline underline-offset-4" href="/docs/companion/setup">setup guide</a>. You’ll need a Samsung Tizen TV and a computer or mobile installer on the same network.</p></div>
</div>
