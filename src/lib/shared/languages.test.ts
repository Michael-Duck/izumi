import { describe, it, expect } from 'vitest'
import { LANGUAGE_DATA, PLAYBACK_LANGUAGES, playbackLanguageName } from './languages'
import { normalizeLang } from '../stremio/sublang'

describe('complete playback language registry', () => {
  it('offers the ISO 639-2 registry with Japanese and English pinned', () => {
    expect(LANGUAGE_DATA).toHaveLength(487)
    expect(PLAYBACK_LANGUAGES.length).toBeGreaterThan(480)
    expect(PLAYBACK_LANGUAGES.slice(0, 2).map(row => row.value)).toEqual(['jpn', 'eng'])
    expect(new Set(PLAYBACK_LANGUAGES.map(row => row.value)).size).toBe(PLAYBACK_LANGUAGES.length)
  })
  it.each([['ta', 'tam'], ['Swahili', 'swa'], ['Welsh', 'wel'], ['cym', 'wel'], ['eu-ES', 'baq'], ['Telugu', 'tel'], ['French', 'fre']])('normalizes %s to %s', (label, code) => {
    expect(normalizeLang(label)).toBe(code)
  })
  it('does not guess a language from an incidental new ISO token in a release label', () => {
    expect(normalizeLang('new release rip')).toBeUndefined()
    expect(playbackLanguageName('')).toBe('')
    expect(playbackLanguageName('tam')).toBe('Tamil')
  })
})
