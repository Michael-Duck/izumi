<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { hasTauriRuntime } from '$lib/platform'
  import { parseTvSetupLink } from '$lib/companion/tv-setup-link'
  import { invokeTvSetup, TV_SETUP_ORIGIN } from '$lib/companion/tv-setup-bridge'

  let frame = $state<HTMLIFrameElement>()
  let source = $state('')
  let busy = false

  onMount(() => {
    const parsed = parseTvSetupLink(`izumi://tv/setup${page.url.hash}`)
    const fragment = parsed?.includes('#') ? parsed.slice(parsed.indexOf('#')) : ''
    source = `${TV_SETUP_ORIGIN}/${hasTauriRuntime() ? '?native=1' : ''}${fragment}`
    window.history.replaceState(window.history.state, '', page.url.pathname)
    async function receive(event: MessageEvent) {
      if (!hasTauriRuntime() || event.source !== frame?.contentWindow || event.origin !== TV_SETUP_ORIGIN) return
      const message = event.data
      if (message?.type === 'izumi.cloudflare.hello' && typeof message.nonce === 'string' && message.nonce.length <= 64) {
        frame.contentWindow?.postMessage({ type: 'izumi.cloudflare.ready', nonce: message.nonce }, TV_SETUP_ORIGIN)
        return
      }
      if (message?.type !== 'izumi.cloudflare.request' || typeof message.id !== 'string' || message.id.length > 64) return
      const destination = frame.contentWindow
      if (busy) {
        destination?.postMessage({ type: 'izumi.cloudflare.result', id: message.id, error: 'Cloudflare setup is already running.' }, TV_SETUP_ORIGIN)
        return
      }
      try {
        busy = true
        const result = await invokeTvSetup(message.method, message.input)
        destination?.postMessage({ type: 'izumi.cloudflare.result', id: message.id, result }, TV_SETUP_ORIGIN)
      } catch (reason) {
        const error = String(reason instanceof Error ? reason.message : reason).replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 400)
        destination?.postMessage({ type: 'izumi.cloudflare.result', id: message.id, error }, TV_SETUP_ORIGIN)
      } finally { busy = false }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  })
</script>

<svelte:head><title>TV setup · izumi</title></svelte:head>
<div class="tv-setup">
  <a href="/app/settings/sync" class="back">← Back to Device sync</a>
  {#if source}<iframe bind:this={frame} src={source} title="izumi TV Cloudflare setup" referrerpolicy="no-referrer" allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"></iframe>{/if}
</div>
<style>
  .tv-setup { display: flex; flex-direction: column; height: calc(100dvh - 80px); min-height: 500px; }
  .back { padding: 14px 24px; font-size: 14px; font-weight: 700; }
  iframe { border: 0; width: 100%; flex: 1; background: #0c0e10; border-radius: 12px; }
</style>
