<script lang="ts">
  let { mode = 'both' }: { mode?: 'anime' | 'movies' | 'both' } = $props()
  const films = ['oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', 'gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', '39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', 'qJ2tW6WMUDux911r6m7haRef0WH.jpg', '8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', 'd5NXSklXo0qyIYkgV94XAgMIckC.jpg']
    .map(path => 'https://image.tmdb.org/t/p/w342/' + path)
  const anime = ['bx154587-qQTzQnEJJ3oB.jpg', 'bx16498-buvcRTBx4NSm.jpg', 'bx113415-LHBAeoZDIsnF.jpg', 'bx127230-DdP4vAdssLoz.png', 'bx151807-it355ZgzquUd.png', 'bx21-ELSYx3yMPcKM.jpg']
    .map(path => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/' + path)
</script>

<div class="artwork-wall" data-mode={mode} aria-hidden="true">
  <div class="poster-columns">
    {#each [0, 1, 2] as column}
      <div class="poster-column" class:reverse={column === 1}>
        <!-- Identical halves make the loop seamless. Images stay mounted when the focus changes,
             so choosing a catalog crossfades the artwork without resetting its movement. -->
        {#each [0, 1] as repeat (repeat)}
          <div class="poster-group">
            {#each films as _, index}
              {@const mixedAnime = (index + column) % 2 === 0}
              <div class="poster">
                <img src={films[(index + column * 2) % films.length]} class:shown={mode === 'movies' || (mode === 'both' && !mixedAnime)} alt="" draggable="false" decoding="async" referrerpolicy="no-referrer" onload={(event) => (event.currentTarget as HTMLImageElement).dataset.loaded = 'true'} onerror={(event) => delete (event.currentTarget as HTMLImageElement).dataset.loaded} />
                <img src={anime[(index + column * 2) % anime.length]} class:shown={mode === 'anime' || (mode === 'both' && mixedAnime)} alt="" draggable="false" decoding="async" referrerpolicy="no-referrer" onload={(event) => (event.currentTarget as HTMLImageElement).dataset.loaded = 'true'} onerror={(event) => delete (event.currentTarget as HTMLImageElement).dataset.loaded} />
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .artwork-wall { position: absolute; inset: 0; overflow: hidden; background: #121316; contain: paint; }
  .artwork-wall::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg, #111216 0%, #11121618 30%, #11121640 100%); pointer-events: none; }
  .poster-columns { --poster-gap: 1rem; position: absolute; inset: -22% -12%; display: grid; align-items: start; grid-template-columns: repeat(3, 1fr); gap: var(--poster-gap); transform: rotate(10deg); }
  .poster-column { animation: drift 140s linear infinite; will-change: transform; }
  .poster-column.reverse { margin-top: -35%; animation-direction: reverse; }
  .poster-group { display: grid; gap: var(--poster-gap); padding-bottom: var(--poster-gap); }
  .poster { position: relative; aspect-ratio: 2 / 3; overflow: hidden; border-radius: .6rem; background: #24262e; box-shadow: 0 8px 24px #0005; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 650ms cubic-bezier(.2, .65, .3, 1); }
  img.shown:global([data-loaded]) { opacity: .88; }
  @keyframes drift { from { transform: translateY(0); } to { transform: translateY(-50%); } }
  @media (max-width: 767px) { .poster-columns { --poster-gap: .65rem; inset: -130% -5%; } }
  @media (prefers-reduced-motion: reduce) { .poster-column { animation: none; will-change: auto; } img { transition: none; } }
</style>
