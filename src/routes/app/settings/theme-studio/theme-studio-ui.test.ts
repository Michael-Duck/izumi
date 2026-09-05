import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')
const editor = readFileSync(fileURLToPath(new URL('../../../../lib/components/settings/ThemeStudio.svelte', import.meta.url)), 'utf8')
const shell = readFileSync(fileURLToPath(new URL('../../+layout.svelte', import.meta.url)), 'utf8')

describe('Theme Studio UI', () => {
  it('applies every draft live across the app without an opt-in toggle', () => {
    expect(editor).toContain('themeStudioPreview.set(clone(draft))')
    expect(editor).toContain('aria-label="Theme controls"')
    expect(editor).not.toContain('aria-label="Theme preview"')
    expect(editor).not.toContain('studio-preview')
    expect(editor).toContain("$themePreset = 'custom'")
    expect(editor).toContain('Save theme')
    expect(editor).toContain('Discard')
    expect(editor).toContain('onDestroy(closeThemeStudio)')
    expect(page).toContain('openThemeStudio()')
    expect(shell).toContain('<Lazy load={loadThemeStudio}>')
    expect(editor).toContain('aria-label="Minimize Theme Studio"')
  })

  it('edits the full token surface and visual system controls', () => {
    for (const token of ['background', 'foreground', 'card', 'theme', 'ring', 'primary', 'secondary', 'accent', 'muted', 'border', 'input']) {
      expect(editor).toContain(`key: '${token}'`)
    }
    expect(editor).toContain('Type & shape')
    expect(editor).toContain('Ambient backdrop')
    expect(editor).toContain('tokenContrast')
  })

  it('supports a saved library and safe theme-file portability', () => {
    expect(editor).toContain('duplicateStudioTheme')
    expect(editor).toContain('deleteStudioTheme')
    expect(editor).toContain('stringifyStudioTheme')
    expect(editor).toContain('parseStudioTheme')
  })
})
