# Cloudflare source lookup failure — 2026-09-06

The affected private Worker had a saved, enabled TorBox profile and the configured
Torrentio source. Missing debrid configuration was not the cause.

Authenticated checks through the TV's existing Worker pairing reproduced empty
results for Shrek (TMDB 808) and The Secret of Skinwalker Ranch S01E01 (TMDB
101359). The configured Torrentio add-on returned 112 Shrek streams when requested
from the desktop network. From Cloudflare it returned HTTP 403. The resolver
previously swallowed upstream failures, so the TV displayed its generic suggestion
to configure a debrid provider.

## Implemented and deployed

- Source lookup failures now reach the existing `failures` response field. Messages
  identify the add-on hostname and HTTP status without exposing configured URL
  paths, query strings, credentials, or upstream response bodies.
- Rejected HTTP responses are cancelled before returning, releasing fetch slots.
- IMDb and TMDB identifiers from Stremio catalogues can reach all configured
  stream add-ons. Custom identifiers remain scoped to their originating add-on,
  and embedded video streams retain their existing precedence.
- Up to three add-ons are queried concurrently, instead of two. Each add-on still
  limits its stream requests to two at a time.
- Empty responses no longer claim that an already configured debrid account is
  missing.

The updated Worker bundle was deployed to the user's specified Worker after
backing up its deployed code. Its existing database binding was preserved; no
database migration, profile change, source installation, TV deployment, or
credential change was performed.

## TV-assisted fallback

The Worker now offers a `tvSourceLookup` continuation when a capable TV requests
playback and cloud source requests fail. The TV requests public torrent metadata
over its home connection, then submits it to the Worker for cache ranking and
debrid resolution. The initial supported adapter is Torrentio. Only known public
configuration options are included; debrid credentials remain in the Worker.

Tickets expire after two minutes and bind the request to the pairing, viewer, and
current resolver profile. Their original resolve timestamp is consumed with a
conditional D1 update so a ticket cannot be replayed or resume a superseded play.
Returned URLs, headers, and caller-supplied cache/ranking flags are discarded.
The Worker accepts bounded torrent metadata and uses its native provider adapter
to create the final media URL. TorBox requests now propagate cancellation.

Cloud source discovery has a shared 12-second limit; debrid attempts use the
remaining resolution budget. Native cache checking prioritizes ready releases.
The TV performs one assisted round and preserves the existing paired-client fallback
policy if it still cannot resolve a source. Older TVs keep their current behavior.

## Verification

The resolver, catalogue, and Worker contract suites passed (33 tests), including
new coverage for catalogue-to-stream routing, custom identifier isolation, blocked
upstreams, and credential-safe errors. After deployment, Shrek returned the
Torrentio 403 diagnostic in 627 ms, and Skinwalker Ranch S01E01 in 692 ms. These are
lookup/error timings, not successful playback timings.

After deploying the assisted protocol, a live harness running the TV lookup module
over the home network resolved Shrek through TorBox in 2,851 ms and Skinwalker Ranch
S01E01 in 2,774 ms. Both resulting media URLs answered HEAD with HTTP 200 and byte
range support. The harness used the paired TV's authenticated Worker route; no izumi
playback service was involved. This verifies resolution and media availability,
not decoding or playback on the physical Samsung TV.

The updated Companion widget must be installed before the physical TV can advertise
this capability. Keep deployment checks separate from the home-network harness.
