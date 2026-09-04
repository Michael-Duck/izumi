import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const component = readFileSync(fileURLToPath(new URL('./TraktAccountSettings.svelte', import.meta.url)), 'utf8')

describe('native Trakt account settings', () => {
  it('uses device authorization and keeps all credentials scoped to the active profile', () => {
    expect(component).toContain("import('$lib/trakt/auth')")
    expect(component).toContain('deviceCode.userCode')
    expect(component).toContain('inside the active profile')
    expect(component).toContain('never includes it in profile sync')
  })

  it('exposes loading, cancellation, error, and connected states', () => {
    expect(component).toContain('Waiting for browser approval')
    expect(component).toContain('onclick={cancel}')
    expect(component).toContain('role="alert"')
    expect(component).toContain('Open profile')
  })
})
