import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export const TV_SETUP_ORIGIN = 'https://tv-link.izumi.watch'

export async function invokeTvSetup(method: unknown, input: unknown): Promise<unknown> {
  const value = input as Record<string, unknown> | null
  if (!value || typeof value !== 'object') throw new Error('Invalid TV setup request.')
  if (method === 'openExternal') {
    const url = new URL(String(value.url || ''))
    if (url.protocol !== 'https:' || url.username || url.password || !['dash.cloudflare.com', 'www.cloudflare.com'].includes(url.hostname)) throw new Error('Invalid Cloudflare link.')
    return openUrl(url.href)
  }
  if (method === 'accounts') {
    if (typeof value.apiToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.apiToken)) throw new Error('Paste a complete Cloudflare API token.')
    return invoke('cloudflare_deployment_accounts', { apiToken: value.apiToken })
  }
  if (value.acceptTerms !== true || typeof value.bootstrapSecret !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.bootstrapSecret)) throw new Error('Accept Cloudflare terms before starting setup.')
  if (method === 'preview') return invoke('cloudflare_create_preview', { acceptTerms: true, bootstrapSecret: value.bootstrapSecret })
  if (method === 'deploy') {
    if (typeof value.apiToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.apiToken) || typeof value.accountId !== 'string' || !/^[a-f0-9]{32}$/i.test(value.accountId)) throw new Error('Apply a valid API token and choose an account.')
    return invoke('cloudflare_deploy_worker', { apiToken: value.apiToken, accountId: value.accountId, bootstrapSecret: value.bootstrapSecret, existing: null })
  }
  throw new Error('Unsupported TV setup operation.')
}
