import { describe, expect, it } from 'vitest'
import { classifyChapter, classifyChapterMark, mergeSkipSegments, segmentsFromChapters, type Chapter } from './chapter-skip'
import { mergeOverlapping, type Segment } from '$lib/stremio/aniskip'

describe('chapter title classification', () => {
  it('recognises the common opening namings', () => {
    for (const t of ['OP', 'op', 'Opening', 'OP1', 'NCOP', 'Opening Credits', 'Intro', 'Theme Song', 'OP - Gurenge']) {
      expect(classifyChapter(t), t).toBe('op')
    }
  })

  it('recognises the common ending namings', () => {
    for (const t of ['ED', 'Ending', 'ED2', 'NCED', 'Outro', 'Closing', 'End Credits', 'Ending Song']) {
      expect(classifyChapter(t), t).toBe('ed')
    }
  })

  it('recognises recaps', () => {
    for (const t of [
      'Recap', 'Previously', 'Previously On', 'Summary',
      'Last Time', 'Last Time On', 'Last On', 'Story So Far', 'The Story So Far',
    ]) {
      expect(classifyChapter(t), t).toBe('recap')
    }
  })

  it('reads a paired edge mark as that edge, not as the whole segment', () => {
    // "Recap Start" satisfies the plain recap pattern too. Resolving it as a span is the misread
    // that lets the closing mark open a second segment over real content.
    expect(classifyChapterMark('Recap Start')).toEqual({ type: 'recap', boundary: 'start' })
    expect(classifyChapterMark('recap end')).toEqual({ type: 'recap', boundary: 'end' })
    expect(classifyChapterMark('Intro Start')).toEqual({ type: 'op', boundary: 'start' })
    expect(classifyChapterMark('OP - End')).toEqual({ type: 'op', boundary: 'end' })
    expect(classifyChapterMark('Credits_Begin')).toEqual({ type: 'ed', boundary: 'start' })
    expect(classifyChapterMark('Ending Finish')).toEqual({ type: 'ed', boundary: 'end' })
  })

  it('keeps names that merely look like edge marks as whole segments', () => {
    for (const t of ['Ending', 'End Credits', 'Opening', 'Closing']) {
      expect(classifyChapterMark(t)?.boundary ?? null, t).toBeNull()
    }
  })

  it('does not invent a type from the edge word alone', () => {
    for (const t of ['Part A Start', 'Scene End', 'Start', 'End']) {
      expect(classifyChapterMark(t), t).toBeNull()
    }
  })

  it('refuses generic namings rather than guessing', () => {
    // A false positive here seeks the user out of real content — far worse than no skip button.
    for (const t of ['Chapter 01', 'Chapter 2', 'Part 1', 'Untitled', '00:00:00', 'A', '', '   ', 'Episode 5']) {
      expect(classifyChapter(t), t).toBeNull()
    }
  })

  it('recognises the common next-episode preview namings', () => {
    for (const t of ['Preview', 'Next Episode', 'Next Ep', 'Next Episode Preview', 'Next Time', 'Next Time On', 'Sneak Peek', 'Yokoku']) {
      expect(classifyChapter(t), t).toBe('preview')
    }
  })

  it('does not match a theme word buried in an episode-title chapter', () => {
    // These are chapter names for actual content. Matching on a contained word would skip the scene.
    expect(classifyChapter('The Opening of the Gate')).toBeNull()
    expect(classifyChapter('Reopening the case')).toBeNull()
    expect(classifyChapter('Shopping trip')).toBeNull()
    expect(classifyChapter('A Recap of the Plan')).toBeNull()
  })

  it('does not match a chapter that is a sentence starting with a theme word', () => {
    // The word leads, but what follows is prose, not a qualifier or a song title. Matching these
    // seeks the viewer out of the scene the chapter names.
    for (const t of [
      'Opening the vault', 'Intro to the case', 'Credits roll over the city',
      'Recap of the war', 'Ending of an era', 'Preview screening at the cinema',
    ]) {
      expect(classifyChapter(t), t).toBeNull()
    }
  })

  it('still accepts an index, a qualifier or a song title after the stem', () => {
    // The flip side of the anchor: these are how releases actually decorate a theme chapter.
    expect(classifyChapter('Opening Theme 「Gurenge」')).toBe('op')
    expect(classifyChapter('ED2 - Song Name')).toBe('ed')
    expect(classifyChapter('OP 1 (Creditless)')).toBe('op')
    expect(classifyChapter('Ending Theme 2')).toBe('ed')
    // A named show after these phrases is expected, not prose to reject.
    expect(classifyChapter('Previously on Some Series')).toBe('recap')
    expect(classifyChapter('Next Time on Some Series')).toBe('preview')
  })
})

describe('segmentsFromChapters', () => {
  const chapters: Chapter[] = [
    { time: 0, title: 'Prologue' },
    { time: 24, title: 'Opening' },
    { time: 114, title: 'Part A' },
    { time: 1_290, title: 'Ending' },
    { time: 1_380, title: 'Preview' },
  ]

  it('derives bands bounded by the next chapter, and the last one by the duration', () => {
    const segs = segmentsFromChapters(chapters, 1_420)
    expect(segs).toEqual([
      { start: 24, end: 114, type: 'op', label: 'Opening' },
      { start: 1_290, end: 1_380, type: 'ed', label: 'Ending' },
      { start: 1_380, end: 1_420, type: 'preview', label: 'Preview' },
    ])
  })

  it('runs the last chapter to the file duration', () => {
    expect(segmentsFromChapters([{ time: 1_300, title: 'ED' }], 1_390)[0])
      .toEqual({ start: 1_300, end: 1_390, type: 'ed', label: 'Ending' })
  })

  it('returns nothing without a duration, rather than a segment of unknown length', () => {
    expect(segmentsFromChapters(chapters, 0)).toEqual([])
  })

  it('returns nothing for a generically chaptered release', () => {
    expect(segmentsFromChapters(
      [{ time: 0, title: 'Chapter 01' }, { time: 600, title: 'Chapter 02' }], 1_400,
    )).toEqual([])
  })

  it('rejects an implausibly long theme (a mis-tagged chapter)', () => {
    // "Opening" running 20 minutes is a muxing accident, not an OP.
    expect(segmentsFromChapters([{ time: 60, title: 'Opening' }], 1_400)).toEqual([])
  })

  it('rejects a segment too short to be worth skipping', () => {
    expect(segmentsFromChapters(
      [{ time: 60, title: 'OP' }, { time: 62, title: 'Part A' }], 1_400,
    )).toEqual([])
  })

  it('sorts unordered chapters and drops ones past the end of the file', () => {
    const segs = segmentsFromChapters(
      [
        { time: 1_300, title: 'ED' },
        { time: 24, title: 'OP' },
        { time: 114, title: 'Part A' },
        { time: 9_999, title: 'OP' },
      ],
      1_400,
    )
    expect(segs.map((s) => s.type)).toEqual(['op', 'ed'])
    expect(segs[0]).toEqual({ start: 24, end: 114, type: 'op', label: 'Opening' })
  })

  it('rejects an OP whose next chapter is 20 minutes away — nothing bounds it as a theme', () => {
    expect(segmentsFromChapters(
      [{ time: 24, title: 'OP' }, { time: 1_300, title: 'ED' }], 1_400,
    ).map((s) => s.type)).toEqual(['ed'])
  })
})

describe('paired edge marks', () => {
  it('bounds a recap by its own closing mark', () => {
    expect(segmentsFromChapters([
      { time: 0, title: 'Recap Start' },
      { time: 85, title: 'Recap End' },
      { time: 85, title: 'Opening' },
      { time: 175, title: 'Part A' },
    ], 1_420)).toEqual([
      { start: 0, end: 85, type: 'recap', label: 'Recap' },
      { start: 85, end: 175, type: 'op', label: 'Opening' },
    ])
  })

  it('never lets a closing mark open a segment over the content after it', () => {
    // The regression this pair exists for: "Recap End" also reads as a recap, so before the pairing
    // it started a second band running to the next mark five minutes into the episode.
    const segs = segmentsFromChapters([
      { time: 0, title: 'Recap Start' },
      { time: 85, title: 'Recap End' },
      { time: 400, title: 'Part B' },
    ], 1_420)
    expect(segs).toEqual([{ start: 0, end: 85, type: 'recap', label: 'Recap' }])
  })

  it('spans an unnamed mark sitting between the pair', () => {
    expect(segmentsFromChapters([
      { time: 12, title: 'Recap Start' },
      { time: 40, title: 'Chapter 02' },
      { time: 96, title: 'Recap End' },
    ], 1_420)).toEqual([{ start: 12, end: 96, type: 'recap', label: 'Recap' }])
  })

  it('falls back to the next chapter when the pair never closes', () => {
    expect(segmentsFromChapters([
      { time: 24, title: 'Opening Start' },
      { time: 114, title: 'Part A' },
    ], 1_420)).toEqual([{ start: 24, end: 114, type: 'op', label: 'Opening' }])
  })

  it('does not span a dangling opening mark across the next one', () => {
    // Two starts and one end: the first was left unclosed, so it takes the next-chapter bound
    // instead of swallowing everything up to the surviving closer.
    expect(segmentsFromChapters([
      { time: 0, title: 'Recap Start' },
      { time: 90, title: 'Intro Start' },
      { time: 180, title: 'Intro End' },
    ], 1_420)).toEqual([
      { start: 0, end: 90, type: 'recap', label: 'Recap' },
      { start: 90, end: 180, type: 'op', label: 'Opening' },
    ])
  })

  it('trusts a stated recap span past the inferred ceiling, but not a whole-episode one', () => {
    const marked = segmentsFromChapters(
      [{ time: 0, title: 'Recap Start' }, { time: 450, title: 'Recap End' }], 1_420,
    )
    expect(marked).toEqual([{ start: 0, end: 450, type: 'recap', label: 'Recap' }])
    expect(segmentsFromChapters(
      [{ time: 0, title: 'Recap Start' }, { time: 1_380, title: 'Recap End' }], 1_420,
    )).toEqual([])
  })

  it('bounds a preview by its own closing mark', () => {
    expect(segmentsFromChapters([
      { time: 1_290, title: 'ED' },
      { time: 1_380, title: 'Preview Start' },
      { time: 1_410, title: 'Preview End' },
    ], 1_420)).toEqual([
      { start: 1_290, end: 1_380, type: 'ed', label: 'Ending' },
      { start: 1_380, end: 1_410, type: 'preview', label: 'Preview' },
    ])
  })

  it('holds a stated theme to the same ceiling as an inferred one', () => {
    // An "opening" running four minutes is a mis-tag whether or not both edges were written down.
    expect(segmentsFromChapters(
      [{ time: 24, title: 'Opening Start' }, { time: 300, title: 'Opening End' }], 1_420,
    )).toEqual([])
  })
})

describe('mergeOverlapping', () => {
  it('unions an op and a mixed-op annotation of the same theme', () => {
    const merged = mergeOverlapping([
      { start: 24, end: 114, type: 'op', label: 'Opening' },
      { start: 30, end: 120, type: 'op', label: 'Opening' },
    ])
    expect(merged).toEqual([{ start: 24, end: 120, type: 'op', label: 'Opening' }])
  })

  it('keeps distinct types apart even when they overlap', () => {
    const merged = mergeOverlapping([
      { start: 0, end: 90, type: 'recap', label: 'Recap' },
      { start: 60, end: 150, type: 'op', label: 'Opening' },
    ])
    expect(merged).toHaveLength(2)
  })

  it('keeps two genuinely separate segments of one type', () => {
    const merged = mergeOverlapping([
      { start: 24, end: 114, type: 'op', label: 'Opening' },
      { start: 1_290, end: 1_380, type: 'op', label: 'Opening' },
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('mergeSkipSegments', () => {
  const aniskip: Segment[] = [{ start: 24, end: 114, type: 'op', label: 'Opening' }]

  it('drops a chapter segment that AniSkip already covers', () => {
    const merged = mergeSkipSegments(aniskip, [{ start: 20, end: 110, type: 'op', label: 'Opening' }])
    expect(merged).toEqual(aniskip)
  })

  it('keeps a chapter segment AniSkip missed', () => {
    const ed: Segment = { start: 1_290, end: 1_380, type: 'ed', label: 'Ending' }
    expect(mergeSkipSegments(aniskip, [ed])).toEqual([...aniskip, ed])
  })

  it('falls back entirely to chapters when AniSkip has nothing', () => {
    const chapterSegs: Segment[] = [{ start: 24, end: 114, type: 'op', label: 'Opening' }]
    expect(mergeSkipSegments([], chapterSegs)).toEqual(chapterSegs)
  })

  it('returns segments in playback order', () => {
    const merged = mergeSkipSegments(aniskip, [{ start: 0, end: 20, type: 'recap', label: 'Recap' }])
    expect(merged.map((s) => s.start)).toEqual([0, 24])
  })
})
