# Worker TV playback and subtitles

The cloud resolver keeps up to three successful converted releases instead of stopping at the first success. It preserves ranked direct choices, bounds conversion attempts to the existing deadline, ignores optional sidecar failures after video resolution, and rejects explicit supplemental or incompatible releases before conversion. The generated resolver core carries the shared suitability checks and subtitle name normalization.

Subtitle-only add-ons are queried according to manifest type/identifier capabilities. Subtitle data already discovered before a signed TV continuation is carried in its bounded plan, avoiding a second stream scrape. Embedded stream metadata can still query subtitle capabilities without invoking stream resources.

The desktop profile now supplies enabled portable subtitle-service configuration, the preferred language, appearance, and an unexpired session when available. Passwords are excluded. Public profile responses expose only configured status. Search uses the exact film/episode identifier; downloading happens only after track selection.

The Worker signs six-hour subtitle references with an owner credential digest and scopes each reference to its TV pairing. Download references contain a service index and file identifier, not service credentials. The delivery route verifies signatures and expiry, resolves the selected file, validates public addresses at each redirect, bounds redirects/bytes/time, and returns plain text with CORS. Error pages are rejected as subtitle files. Removing the owner or pairing invalidates delivery.

The companion implementation is in the standalone TV repository. Tests cover multiple converted alternatives, supplemental/format rejection, subtitle-only manifests, exact episode queries, deferred downloads, credential redaction, ticket scope/expiry, private redirects and oversized/invalid responses. The embedded direct-upload Worker bundle is regenerated from this source.

Rollout requires deploying the updated Worker and TV widget, then saving TV playback settings from the updated desktop client so existing private profiles receive subtitle configuration. Local builds and mocked API checks do not verify a live subtitle quota, an installed TV or hardware decoder output.
