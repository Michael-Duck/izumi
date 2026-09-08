# Watch-habit corrections

Implemented locally on 8 September 2026 following the existing-system audit. The original
[9 passing controls and 10 failing criteria](results.json) remain available as historical evidence.
No production Worker or physical TV was changed by this task.

## Behavior corrected

- **E1:** Opening an episode without confirmed progress no longer seeds either recommendation
  row. Unknown episode totals do not imply completion. `watchedAt` separates confirmed viewing
  from later opens and survives backup/sync. Existing entries fall back to their original timestamp.
- **E2/E3:** A direct rating independently determines affinity: 0 means unrated, 60/100 neutral,
  below 60 negative, above 60 positive. Direct ratings and dismissals have higher priority than
  saves; the newer direct opinion wins. `scoreUpdatedAt` survives automatic progress/list updates.
  A neutral direct opinion suppresses weaker positive signals for the same verified title.
- **E4/E7:** Compact history retains bounded, non-spoiler taste metadata. Duplicate candidate
  and seed features combine across verified IDs, while a single title contributes only one
  resolved preference. The first candidate remains the display identity; missing richer features
  no longer disappear merely because a sparse catalog record arrived first.
- **E5/E8:** Companion ranking builds identity unions before limiting scoring signals. Its
  100-signal budget reserves 40 slots for direct choices, 30 for library and 30 for history,
  redistributing unused slots. Known-title exclusions include verified aliases even when a
  title has no positive seed or falls outside the scoring budget.
- **E6:** The older anime row no longer positively seeds recommendations from ratings at or below
  60. Explicit account/local opinions supersede incidental history during seed merging. This row
  still uses its existing recommendation-edge ranker rather than Discover's signed affinity model.
- **E9/E10:** Checkpoints retain the supplied event time in history, positions and forwarded tracker
  dates. Season-relative TV episodes resolve through the owning catalog's video table, including
  specials. Native episode 1 in season 2 therefore resumes at the matching desktop video number.
  Counts alone are not used to guess ordering. Unavailable or mismatched metadata leaves a
  checkpoint unapplied and retryable through the existing transport. Profile authorization is
  checked again after asynchronous metadata loading; newer local history/positions and existing
  checkpoint deduplication remain authoritative.

Recovered completion still advances linked tracker progress, with the original viewing date.
It does not infer a new rewatch from replaying an already completed checkpoint. Movie checkpoints
are treated as one complete item even without an episode-count field. Timestamped history uses
Trakt's `watched_at` field at the movie/episode level; the supported native episode payload is
illustrated in the [Trakt API repository](https://github.com/trakt/trakt-api/issues/224).

These are main-client corrections using the existing Companion payload and encrypted Worker
transport. No Worker migration, TV protocol change, collaborative dataset or watch-minute
telemetry is introduced.

## Validation and limits

Final validation: **168 tests passed across 23 targeted files**, including all **34 audit and
added regression cases**. `npm run check --ignore-scripts` reported **0 errors and 0 warnings**.
`npm run cloudflare:bundle:check`, `npm run i18n:check` and `git diff --check` also passed.
The regression-only JSON is a subset of the same full targeted run, not a second independent run.

The acceptance cases were promoted into normal Vitest discovery:
[recommendations](../../src/lib/recommendations/watch-habits-regressions.test.ts) and
[checkpoints](../../src/lib/companion/checkpoint-regressions.test.ts). Additional cases exercise
neutral/latest opinions, rating/viewing clocks, metadata bounds, over-budget aliases, native
resume lookups, specials, movies, offline retry, stale records, and profile changes during loading.
Tracker tests verify forwarding original dates and suppressing inferred rewatches; backup tests
verify timestamp round trips. See [current regression results](fixed-results.json) and
[broader targeted results](fixed-existing-tests.json).

The targeted run covers the recommendation directory, the shared engine, Companion checkpoint,
profile and snapshot suites, history import/export and persistence, resume positions, incognito,
local lists, tracker progress and Trakt sync, encrypted Companion/discovery sync, and Worker
account/profile tests. This is not a claim that the entire repository test suite was executed.

E1's original assertion assumed every opening produced a seed. It now explicitly checks that
zero progress produces none. Checkpoint tests now mock the catalog detail adapter as well as
cloud delivery, because native-to-desktop episode translation requires that table. They verify
both independent stored positions and the actual `getPosition` resume values. No real account
or viewing history is used in the fixtures.

The [updated synthetic benchmark](fixed-benchmark-results.json) records the engine hash and raw
timings, including a 1,000-candidate/1,000-signal case capped at 100 scoring signals. Larger runs
show substantial timing variance during concurrent workspace activity. These elapsed times do
not establish a production latency target, performance improvement, or Worker CPU compliance.

Historical data already saved with a wrong timestamp or overwritten season position cannot be
reconstructed safely from the local record alone. Previously applied checkpoint IDs are retained
to avoid replaying old history over newer local state. Older sparse snapshots acquire richer
features only when refreshed from metadata. A watched-through marker remains an episode marker,
not distinct watched episodes or unique consumed minutes; partial viewing below the watched
threshold remains outside the taste model. The 85% watched-state threshold is unchanged.

The next relevance evaluation needs representative profiles, time-split watch histories, eligible
catalog coverage, candidate recall and measured user responses. No accuracy gain is claimed
from synthetic regression tests. Independent Worker ranking and physical-TV recovery still need
their own runtime/device evaluation.
