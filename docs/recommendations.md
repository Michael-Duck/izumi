# Discover recommendations

Discover lives under Library in the main client and beside My List in TV navigation.
It is not a Home call-to-action.

## Candidate coverage

The main client gathers candidates from every enabled catalog through the provider registry.
Automatic anime keeps the existing AniList/Kitsu/Jikan fallback. TMDB, installed Stremio catalogs
(including non-searchable home lists), and enabled JVM catalogs use their existing adapters.
A failed provider does not discard successful results from other providers. Candidate breadth
depends on what each provider exposes; this does not download or rank every title in its database.

Visible-card enrichment supplies synopsis, runtime, ratings and trailers where supported.
Trailers require an explicit action, and unavailable trailers are not invented.

## Ranking and feedback

The AGPL engine is in `src/lib/shared/recommendation-engine.ts`. It has no framework, storage,
network or global-clock dependency. Its inputs are candidate features, weighted taste signals,
exclusions and an explicit timestamp. Its output is ranked identities plus readable evidence.

Profile-local library tracking, ratings, durable watch history and Discover choices supply taste.
Incognito history is excluded. Explicit choices take precedence over incidental viewing of the
same title. Signals decay over time; negative affinity is retained. Known external IDs collapse
cross-catalog duplicates, while identical titles alone do not merge remakes. Genre, tags, people,
studio, language, country, era and format contribute when supplied by a catalog. Quality has a
small role; genre/source variety prevents consecutive picks from becoming repetitive.

Save adds to Watchlist. Not for me changes affinity and hides the title. Skip hides it for seven
days without a negative taste signal. Undo writes a timestamped tombstone so an older synced
device cannot resurrect the choice. Records and tombstones are bounded to 500 each.

This is an explainable content-based system, not collaborative filtering. No measured claim
of better relevance than another app is made. Compare save/dismiss rates and repeat exposure
before choosing a hosted training system such as Gorse.

## TV and licensing boundary

The main client and engine remain AGPL-3.0-or-later. The separate TV repository remains MIT.
**The TV does not bundle the engine.** It receives an ordered candidate list with explanations
through the existing encrypted companion snapshot. The payload contains results, not executable
ranking code or raw taste vectors.

TV can browse its cached deck and save/skip/dismiss/undo offline. These actions filter cards
immediately. Personalized re-ranking requires the linked main client to receive the choices and
publish an updated snapshot. Cloud catalogs can provide additional, explicitly non-personalized
fallback choices while the main client is unavailable. Device-only catalogs use the last snapshot.
Moving ranking to a separate service later is possible without tying the pure engine to the TV UI,
but that needs a deliberate privacy and deployment design.

## Sync and deployment

Ordinary device history sync now includes profile-scoped Discover feedback. TV choices use a
separate authenticated, AES-GCM-encrypted journal. Content stays encrypted; opaque title hashes
and timestamps remain visible to the Worker for routing and stale-write protection. Encryption binds each record to its pairing and discovery context. Profile checks
prevent applying another viewer's choices. Newer local choices win over stale remote choices.

Cloud discovery feedback requires Worker **1.8.0** and migration **0005_companion_discovery.sql**.
The built-in updater includes migrations 0004 and 0005 and the generated Worker bundle.
Older Workers keep ordinary watch sync working; TV choices remain local/pending until upgraded.
Updating source/building does not deploy a Worker or install anything on a physical TV.

Tests cover affinity, deduplication, negative feedback, decaying signals, provider failures, undo
conflicts, encrypted context, authentication, payload bounds and migration inclusion. TV tests
cover result ordering, offline choices, profile isolation and local-network acknowledgement.
