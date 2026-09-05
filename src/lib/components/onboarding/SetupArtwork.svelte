<script lang="ts">
  let { mode = 'both' }: { mode?: 'anime' | 'movies' | 'both' } = $props()
  const films = ['oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', 'gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', '39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', 'qJ2tW6WMUDux911r6m7haRef0WH.jpg', '8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', 'd5NXSklXo0qyIYkgV94XAgMIckC.jpg']
    .map(path => 'https://image.tmdb.org/t/p/w342/' + path)
  const anime = ['bx154587-qQTzQnEJJ3oB.jpg', 'bx16498-buvcRTBx4NSm.jpg', 'bx113415-LHBAeoZDIsnF.jpg', 'bx127230-DdP4vAdssLoz.png', 'bx151807-it355ZgzquUd.png', 'bx21-ELSYx3yMPcKM.jpg']
    .map(path => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/' + path)
  const images = $derived(mode === 'movies' ? films : mode === 'anime' ? anime : films.flatMap((film, index) => [film, anime[index]]))
</script>

<div class="artwork-wall" aria-hidden="true">
  <div class="poster-columns">
    {#each [0, 1, 2] as column}
      <div class="poster-column" class:reverse={column === 1}>
        {#each Array.from({ length: 8 }, (_, index) => images[(index * 3 + column) % images.length]) as url}
          <div class="poster"><img src={url} alt="" draggable="false" referrerpolicy="no-referrer" onerror={(event) => (event.currentTarget as HTMLImageElement).style.opacity = '0'} /></div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .artwork-wall { position: absolute; inset: 0; overflow: hidden; background: #121316; contain: paint; }
  .artwork-wall::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg, #111216 0%, transparent 35%, #11121655 100%); pointer-events: none; }
  .poster-columns { position: absolute; inset: -18% -8%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; transform: rotate(10deg); }
  .poster-column { display: flex; flex-direction: column; gap: 1rem; animation: drift 70s linear infinite alternate; will-change: transform; }
  .poster-column.reverse { margin-top: -35%; animation-direction: alternate-reverse; }
  .poster { aspect-ratio: 2 / 3; flex: 0 0 auto; overflow: hidden; border-radius: .6rem; background: #24262e; box-shadow: 0 8px 24px #0005; }
  img { width: 100%; height: 100%; object-fit: cover; opacity: .8; }
  @keyframes drift { from { transform: translateY(0); } to { transform: translateY(-28%); } }
  @media (max-width: 767px) { .poster-columns { grid-template-columns: repeat(3, 1fr); inset: -100% -5%; gap: .65rem; } }
  @media (prefers-reduced-motion: reduce) { .poster-column { animation: none; will-change: auto; } }
</style>
