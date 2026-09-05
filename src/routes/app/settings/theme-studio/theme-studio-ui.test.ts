import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Theme Studio UI', () => {
  it('previews drafts and explicitly saves the custom theme', () => {
    expect(page).toContain('themeStudioPreview.set(previewAcrossApp ? clone(draft) : null)')
    expect(page).toContain('let previewAcrossApp = $state(false)')
    expect(page).toContain('aria-label="Theme controls"')
    expect(page).toContain('aria-label="Theme preview"')
    expect(page).toContain("$themePreset = 'custom'")
    expect(page).toContain('Save &amp; Apply')
    expect(page).toContain('Discard')
  })

  it('edits the full token surface and visual system controls', () => {
    for (const token of ['background', 'foreground', 'card', 'theme', 'ring', 'primary', 'secondary', 'accent', 'muted', 'border', 'input']) {
      expect(page).toContain(`key: '${token}'`)
    }
    expect(page).toContain('Type &amp; shape')
    expect(page).toContain('Ambient backdrop')
    expect(page).toContain('tokenContrast')
  })

  it('supports a saved library and safe theme-file portability', () => {
    expect(page).toContain('duplicateStudioTheme')
    expect(page).toContain('deleteStudioTheme')
    expect(page).toContain('stringifyStudioTheme')
    expect(page).toContain('parseStudioTheme')
  })
})
