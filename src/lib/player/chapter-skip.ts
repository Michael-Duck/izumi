import { LABELS, mergeOverlapping, type Segment, type SkipType } from '$lib/stremio/aniskip'

// Fallback skip segments derived from the file's own Matroska chapter titles.
//
// AniSkip is crowdsourced and thin outside popular titles, but well-tagged fansub and BD releases
// ship named chapters ("Opening", "ED", "Preview") — and the player already fetches and draws that
// chapter list, it just never read the titles. This turns them into the same Segment shape so the
// skip button, seekbar bands and automatic skipping all work unchanged.

export interface Chapter { time: number; title: string }

/** An OP/ED outside this range is a mis-tagged chapter, not a theme song. Real openings are 60-105s;
 *  the ceiling is deliberately generous for double-length premieres and creditless endings. */
const MIN_SEGMENT_S = 5
const MAX_THEME_S = 210
/** Recaps run longer than a theme (a "previously on" can be a couple of minutes) but not forever. */
const MAX_RECAP_S = 300
/** A closed marker pair states both edges instead of inferring the end from the next mark, so a long
 *  "previously on" is a stated fact rather than a guess and earns a looser ceiling. Still capped: a
 *  pair spanning the whole file is a tagging error, and honouring it would skip the episode. */
const MAX_MARKED_RECAP_S = 600

// Anchored, whitelist-only classification. The common generic namings — "Chapter 01", "Part 1",
// "Untitled", "00:00" — MUST fall through to no match: a wrong guess here seeks the user out of
// actual content, which is far worse than showing no skip button at all.
//
// The recap vocabulary matches what the remote skip databases and other chapter-driven players key
// on ("recap", "previously on", "last time on"), so a file that carries the marker gets the same
// treatment as an episode the remote sources happen to cover.
const PATTERNS: { type: SkipType; re: RegExp }[] = [
  { type: 'op', re: /^(?:nc)?op(?:ening)?(?:\s*\d+)?(?:\s*[-–—:|]\s*.*)?$/i },
  { type: 'op', re: /^(?:opening|intro)\b(?:\s+(?:song|theme|credits|sequence|animation))?\b/i },
  { type: 'op', re: /^(?:theme\s*song|title\s*sequence|main\s*title)\b/i },
  { type: 'ed', re: /^(?:nc)?ed(?:ing)?(?:\s*\d+)?(?:\s*[-–—:|]\s*.*)?$/i },
  { type: 'ed', re: /^(?:ending|outro|closing)\b(?:\s+(?:song|theme|credits|sequence|animation))?\b/i },
  { type: 'ed', re: /^(?:end\s*credits|credits|staff\s*roll)\b/i },
  { type: 'recap', re: /^(?:recap|previously(?:\s+on)?|last\s+time(?:\s+on)?|last\s+on|summary|synopsis)\b/i },
  { type: 'recap', re: /^(?:the\s+)?story\s+so\s+far\b/i },
]

const matchType = (title: string): SkipType | null => PATTERNS.find((p) => p.re.test(title))?.type ?? null

/** Which edge of a segment a chapter mark denotes, or null when the mark IS the segment. */
export type ChapterBoundary = 'start' | 'end'
export interface ChapterMark { type: SkipType; boundary: ChapterBoundary | null }

// Some releases tag the two edges of a segment as a pair of marks ("Recap Start" … "Recap End")
// rather than naming the span itself. Read naively both halves classify as a recap, so the closing
// mark opens a second segment that runs over whatever follows it — real content, silently skipped.
//
// The suffix has to be its own trailing word, which is what keeps "Ending" an ending and leaves
// "End Credits" to the credits pattern above.
const BOUNDARY = /^(.*[^\s\-–—_:|])[\s\-–—_:|]+(start|begin|beginning|end|finish)$/i
const OPENS = /^(?:start|begin|beginning)$/i

/** Classify one chapter title as a theme/recap mark, or null when it is neither. */
export function classifyChapterMark(title: string): ChapterMark | null {
  const clean = title.trim()
  if (!clean) return null
  // Paired markers first: "Recap Start" also satisfies the plain recap pattern, and resolving it as
  // a whole segment is exactly the misread this exists to prevent.
  const paired = BOUNDARY.exec(clean)
  const stem = paired && matchType(paired[1])
  if (stem) return { type: stem, boundary: OPENS.test(paired![2]) ? 'start' : 'end' }
  const whole = matchType(clean)
  return whole ? { type: whole, boundary: null } : null
}

/** Classify one chapter title, or null when it isn't recognisably a theme/recap. Reports the type a
 *  mark refers to, whether it names the span or only one of its edges. */
export function classifyChapter(title: string): SkipType | null {
  return classifyChapterMark(title)?.type ?? null
}

/** Index of the mark closing the pair opened at `from`, or -1 when the pair never closes. A second
 *  opening mark before the closer means this one was left dangling, so we give up and let the
 *  caller fall back to the next-chapter bound rather than spanning across it. */
function closingMarkIndex(marks: (ChapterMark | null)[], from: number): number {
  for (let i = from + 1; i < marks.length; i++) {
    const mark = marks[i]
    if (!mark?.boundary) continue
    if (mark.boundary === 'start') return -1
    if (mark.type === marks[from]!.type) return i
  }
  return -1
}

const ceiling = (type: SkipType, closed: boolean): number =>
  type === 'recap' ? (closed ? MAX_MARKED_RECAP_S : MAX_RECAP_S) : MAX_THEME_S

/** Turn a chapter list into skip segments. A chapter runs until the next one starts (the last runs
 *  to `duration`), so an accurate duration is required — pass 0 and you get nothing rather than a
 *  final segment of unknown length. A mark that names an edge instead of a span runs to its own
 *  closing mark, and a closing mark never opens a segment of its own. */
export function segmentsFromChapters(chapters: Chapter[], duration: number): Segment[] {
  if (!chapters.length || !(duration > 0)) return []
  const sorted = [...chapters]
    .filter((c) => Number.isFinite(c.time) && c.time >= 0 && c.time < duration)
    .sort((a, b) => a.time - b.time)
  const marks = sorted.map((c) => classifyChapterMark(c.title ?? ''))

  const out: Segment[] = []
  for (let i = 0; i < sorted.length; i++) {
    const mark = marks[i]
    if (!mark || mark.boundary === 'end') continue
    const closer = mark.boundary === 'start' ? closingMarkIndex(marks, i) : -1
    const start = sorted[i].time
    const end = closer >= 0 ? sorted[closer].time : Math.min(duration, sorted[i + 1]?.time ?? duration)
    const length = end - start
    if (length < MIN_SEGMENT_S) continue
    if (length > ceiling(mark.type, closer >= 0)) continue
    out.push({ start, end, type: mark.type, label: LABELS[mark.type] })
  }
  return mergeOverlapping(out)
}

/** Prefer AniSkip, fill the gaps from chapters.
 *
 *  AniSkip's crowd timings are tuned to the frame; chapter marks are wherever the muxer put them.
 *  So anything AniSkip already covers wins outright, and a chapter-derived segment is only kept
 *  when it doesn't overlap an AniSkip one at all. */
export function mergeSkipSegments(aniskip: Segment[], fromChapters: Segment[]): Segment[] {
  const overlaps = (s: Segment) => aniskip.some((a) => s.start < a.end && a.start < s.end)
  return [...aniskip, ...fromChapters.filter((s) => !overlaps(s))].sort((a, b) => a.start - b.start)
}
