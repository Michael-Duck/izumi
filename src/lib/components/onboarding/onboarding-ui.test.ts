import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const setup = read('./FirstRunSetup.svelte')
const artwork = read('./SetupArtwork.svelte')

describe('onboarding presentation contracts', () => {
  it('keeps a single artwork wordmark without captions or a visible step header', () => {
    expect(setup.match(/<Wordmark\b/g)).toHaveLength(1)
    expect(setup).toContain('class="art-wordmark"><Wordmark />')
    expect(setup).not.toContain('<header')
    expect(setup).not.toContain('step-progress')
    expect(setup).not.toContain('art-caption')
    expect(setup).toContain('id="setup-progress" class="sr-only"')
    expect(setup.indexOf('<footer')).toBeLessThan(setup.indexOf('</main>'))
  })

  it('keeps the chosen artwork through metadata, access and playback steps', () => {
    expect(setup).toContain("<SetupArtwork mode={step <= 1 ? 'both' : focus} />")
    expect(setup).not.toContain("step === 2 || step === 3 ? 'movies'")
    expect(setup.indexOf('<SetupArtwork')).toBeLessThan(setup.indexOf('{#key step}'))
  })

  it('does not repeat the Automatic anime label on the focus choice', () => {
    const choices = setup.slice(setup.indexOf('{:else if step === 2}'), setup.indexOf('{:else if step === 3}'))
    expect(choices).toContain('m.onboarding_automatic_body()')
    expect(choices).not.toContain('m.onboarding_automatic_anime()')
  })

  it('orients keyboard users on each step without an outline on a non-interactive heading', () => {
    expect(setup).toContain('data-step-heading tabindex="-1" aria-describedby="setup-progress"')
    expect(setup).toContain('.setup-heading:focus { outline: none; box-shadow: none; }')
    expect(setup).toContain('.onboarding-surface button:focus-visible')
    expect(setup).toContain('.focus({ preventScroll: true })')
    expect(setup).toContain('cancelAnimationFrame(frame)')
  })

  it('crossfades mounted images and loops identical groups with reduced-motion support', () => {
    expect(artwork).toContain('{#each [0, 1] as repeat (repeat)}')
    expect(artwork).toContain("class:shown={mode === 'movies' || (mode === 'both' && !mixedAnime)}")
    expect(artwork).toContain("class:shown={mode === 'anime' || (mode === 'both' && mixedAnime)}")
    expect(artwork).not.toContain('$derived(mode')
    expect(artwork).toContain('translateY(-50%)')
    expect(artwork).toContain('transition: opacity')
    expect(artwork).toContain('img.shown:global([data-loaded])')
    expect(artwork).toContain('prefers-reduced-motion: reduce')
    expect(setup).toContain('.setup-content { animation: none; }')
  })

  it.each(['en', 'ja'])('spells the onboarding brand lowercase in %s', locale => {
    const messages = JSON.parse(read(`../../../../messages/${locale}.json`)) as Record<string, string>
    const copy = Object.entries(messages).filter(([key]) => key.startsWith('onboarding_'))
    expect(copy.length).toBeGreaterThan(0)
    expect(copy.filter(([, value]) => /\bIzumi\b/.test(value))).toEqual([])
    expect(messages.onboarding_welcome_title).toContain('izumi')
  })
})
