# Cloud and TV source resolution

When the cloud cannot reach a configured source, a capable TV can fetch public
source metadata over its home connection. The private Worker validates a signed,
short-lived continuation and resolves that metadata using the saved debrid account.
Credentials remain on the Worker. The TV returns no playback URLs, headers or
trusted cache flags. Continuations are bound to the pairing, profile and request;
they expire and can be consumed only once.

The TV includes catalogue ID hints in playback requests. Those hints must be
expanded into compatible source IDs before deciding which lookups are possible.
Previously, a catalogue-only hint bypassed that expansion and prevented the TV
handoff from being offered. Movie and episode requests now retain their supplied
IDs and exact episode coordinates while adding the mapped source ID. Existing
source IDs and custom namespaces keep their previous routing.

Failure messages use generic source wording without exposing upstream hostnames
or configured URL paths. Repository descriptions, release notes and commit
messages should likewise avoid naming upstream stream sources or their endpoints.

Validation covers the exact catalogue-only request shape produced by the TV,
handoff generation, credential protection, ticket expiry, replay rejection,
profile changes and custom source routing. All 67 Worker tests passed.

The deployed correction was exercised with Companion 0.2.39's request builder,
lookup handler and playback-response parser through an existing authenticated
pairing. Movie and episode checks completed in approximately 3.2 and 2.2 seconds,
including media availability checks. Both media URLs supported byte ranges.
This verifies the home-network resolution path; physical-TV playback remains a
separate check. No additional TV update is needed for this Worker correction.
