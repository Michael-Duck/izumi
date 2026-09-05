import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { invokeTvSetup } from './tv-setup-bridge'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))
beforeEach(() => vi.mocked(invoke).mockClear())
it('requires consent and a fresh secret before native provisioning', async () => {
  await expect(invokeTvSetup('preview', { acceptTerms: false })).rejects.toThrow()
  expect(invoke).not.toHaveBeenCalled()
  await invokeTvSetup('preview', { acceptTerms: true, bootstrapSecret: 's'.repeat(43) })
  expect(invoke).toHaveBeenCalledWith('cloudflare_create_preview', { acceptTerms: true, bootstrapSecret: 's'.repeat(43) })
})
it('cannot invoke arbitrary native commands or replace an existing Worker', async () => {
  const input = { acceptTerms: true, bootstrapSecret: 's'.repeat(43), apiToken: 't'.repeat(40), accountId: 'a'.repeat(32), existing: { scriptName: 'unrelated' } }
  await expect(invokeTvSetup('shell', input)).rejects.toThrow('Unsupported')
  await invokeTvSetup('deploy', input)
  expect(invoke).toHaveBeenCalledWith('cloudflare_deploy_worker', expect.objectContaining({ existing: null }))
})
