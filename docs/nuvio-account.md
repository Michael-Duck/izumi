# Nuvio account, collections and Cloud API

Researched and implemented on 6 September 2026. This extends the JSON collection importer with an authenticated browser and full Cloud workspace at `/app/nuvio` (My Nuvio).

The authoritative contract is Nuvio's [public API documentation](https://nuvio.tv/docs), whose page loads [nuvio-public-api.md](https://nuvio.tv/docs/nuvio-public-api.md), version **1.3**, updated **20 August 2026**. Use its `sb_publishable_…` client key in `apikey`; only a real session access token belongs in `Authorization`. The Cloud adapter is `src/lib/nuvio/cloud.ts`, with media mapping and reviewed local transfers in `media.ts` and `transfer.ts`.

## Nuvio's account flow

Nuvio Mobile's [DeviceLinkAuthRepository.kt](https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/commonMain/kotlin/com/nuvio/app/core/auth/DeviceLinkAuthRepository.kt) implements browser-approved device codes. Its [AuthRepository.kt](https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/commonMain/kotlin/com/nuvio/app/core/auth/AuthRepository.kt) also uses Supabase email/password authentication.

The official [community collection gallery](https://nuvio.tv/community-collections), [covers gallery](https://nuvio.tv/covers), and [account collections](https://nuvio.tv/account?tab=collections) use an authenticated Supabase session. The documented backend is `https://api.nuvio.tv`. Izumi identifies itself as `Izumi/<version>` in requests. Native signup handles both immediate sessions and email-confirmation responses. The additional device-code flow below comes from the published native client rather than the public Cloud API contract.

1. Generate a random nonce. POST `start_device_login_session` under `/rest/v1/rpc`, with `p_device_nonce`, `p_redirect_base_url: https://nuvio.tv/link`, `p_device_name: Izumi`, and `p_device_type: mobile`. “mobile” is the non-TV protocol category used by the published native flow.
2. Display the six-character `user_code` and offer `verification_uri_complete`. Izumi accepts only HTTPS links on `nuvio.tv/link`.
3. Poll `poll_tv_login_session` with `p_code: device_code` and the original nonce. Follow the server interval, clamped to 2–10 seconds; stop at 120 attempts, cancellation, expiry, or three consecutive network failures.
4. After `approved`, POST `{code, device_nonce}` to `/functions/v1/tv-logins-exchange`. Store the returned session, retrieving `/auth/v1/user` if the exchange omits the user.

A live anonymous start request using the new publishable key and no anonymous bearer token returned HTTP 200 with a six-character code, the expected `https://nuvio.tv/link` address, and a three-second poll interval. No real account approval or credential exchange was performed during development.

## Read APIs

The website gallery APIs take a session bearer token:

- `GET https://nuvio.tv/api/community-collections`: `search`, `sort=recent|popular`, `type=collection|collection_pack` (omit for all), `page`, `limit=24`.
- `GET /api/community-collections/{public_id}`: detail `item.envelope`, including collection(s), folders, and optional `requirements.addons`.
- `GET https://nuvio.tv/api/covers`: `search`, `sort`, `orientation=all|landscape|portrait`, optional `format=gif|jpg|png`, `page`, `limit=24`. Artwork comes from `image_url`.
- List replies contain `items` and `pagination.hasNextPage`.

Profile APIs use the same bearer token plus the publishable key:

- POST `/rest/v1/rpc/sync_pull_profiles`, body `{}`.
- POST `/rest/v1/rpc/sync_pull_collections`, body `{p_profile_id}`; read `collections_json` from the first result row.
- On explicit source lookup, GET `/rest/v1/addons` filtered to the selected profile with authenticated row-level access. Profiles with `uses_primary_addons` read profile 1's sources. Inspect enabled manifests in batches of four and offer only sources whose manifest ID matches the collection. No undocumented `get_sync_owner` query is needed.

Nuvio's Cloud RPCs now have an officially supported public contract. The community/cover website endpoints remain additional client APIs that may change independently. Self-hosted Nuvio backends are outside this integration.

## User experience

Open **Settings → Catalog → Collections & covers → Browse Nuvio**, or **Settings → Accounts → Nuvio**. Connect with browser approval or email/password.

- **Community:** search, filter collections/packs, sort, and load more. Preview folders and source requirements. Included sources are opt-in and validated before installation. Add to izumi saves to Home.
- **Covers:** search and filter shape/format. Choose a local collection and folder, then apply artwork as the cover or focus artwork. The cover editor links here with the target folder preselected.
- **My Nuvio:** manage profiles, collections, library, resume points, watched history, sources, preferences and Home layout. Review transfers between Nuvio and izumi, with an account status page and public supporter wall.

Imported IDs hash the community/profile origin and original collection ID. Re-adding updates that copy without duplicating it or overwriting unrelated creators' collections. “Update in izumi” explicitly replaces saved cover edits too. Transfers are on demand; signing in does not enable background synchronization or automatically import sources. Remote collection edits use reviewed drafts and a separate Save to Nuvio action. Likes, submissions, reports, and install-count writes are not documented public Cloud capabilities and are not performed.

Sessions persist in the active izumi profile's partition under `nuvio-auth-tokens-v1`, consistent with existing connected accounts. Passwords and device nonces never persist. Sessions refresh on demand, concurrent refreshes coalesce, and disconnect prevents an in-flight result from restoring a session. Logout uses `scope=local` so other Nuvio devices stay signed in. Tokens are excluded from credential-free backups by the existing secret-key filter and are not in the manual settings sync allowlist. Backups explicitly including credentials include these session tokens, like other connected accounts.

The UI uses existing typography, theme tokens, and controls, with keyboard-focusable galleries, native modal previews with Escape/focus restoration, mobile layouts, loading/empty/error states, bounded HTTP responses, and cancellation when navigating away. Account details and gallery results clear on disconnect. Imported Home collections retain the shared-layout/profile-filtering behavior described in [nuvio-collections.md](./nuvio-collections.md).

## Validation

Tests cover device approval/polling/expiry, cancellation, refresh coalescing, stale results after disconnect, foreign-origin rejection, gallery query/response contracts, stable import identities, profile scoping, inherited add-on sources, and failed/cancelled dependency installation. Browser checks use an isolated fixture with simulated account/API responses. Live authenticated gallery access and final device approval still need a real-account acceptance check.

The original collection-browser regression run passed 200 tests (one existing skipped test). The expanded Cloud regression run passed **111 tests** covering authentication/signup, public-key headers, pagination/deltas, batches, stale documents, six-profile preservation and deletion review, source inheritance/query configuration, metadata/episode mapping, milliseconds/seconds, incognito exclusion, portable settings and collection imports. Full `npm run check` passed with zero errors/warnings, including bundle and translation checks. Browser checks use simulated authenticated responses; they do not establish live-account write compatibility.

## Public Cloud feature coverage

| Feature | Operations and client behaviour |
| --- | --- |
| Authentication | Signup, password login, refresh, current user and local logout; native browser linking also retained. |
| Profiles | Pull, create/update the complete six-slot profile list, delete a reviewed profile and its data. Avatar catalog, custom image and colour. |
| Sources | Authenticated table read; add, enable/disable, remove, reorder and save. Inherited sources explicitly edit profile 1. Copy local sources to a draft or install enabled cloud sources after validating all manifests. |
| Library | Paginated snapshot, cursor-based changes, incremental upserts and typed-key deletes; reviewed transfers to/from izumi Watchlist. |
| Watch progress | Latest-200 snapshot, delta refresh, merge upserts and exact progress-key deletes; reviewed transfers to/from izumi player positions. |
| Watched history | All snapshot pages, delta refresh, watched-item upserts and exact movie/episode deletes; reviewed local transfers. |
| Collections | Read/replace the complete raw document; create/edit/reorder/remove collections and folders; cover/focus artwork picker, layouts and catalog references; JSON import/editor; copy in either direction. |
| Preferences | Read/write per-platform blobs, scalar controls and advanced JSON preserving unknown fields. Capture/apply izumi portable preferences after review. |
| Home layout | Separate per-platform document flow for izumi Home layout and collection settings. |
| Account status | Current user, sync overview, public health check, database ping and paginated Top/Recent supporter wall. |

Profile replacement always sends `p_client_max_profiles: 6` and the complete freshly fetched list. The server default is four and would otherwise risk removing slots five and six. Profile deletion requires typing the reviewed name and checks the latest profile before writing.

**PIN limitation:** The public API exposes PIN status but does not document PIN management or unlocking. Izumi displays protected profiles as locked, disables editing and links to Nuvio account management. It does not invent an unlock operation.

## Transfer and conflict behaviour

- Snapshot bootstrap captures a delta cursor before reading the snapshot, reads every required page, then applies all delta pages after that cursor. Cursors advance only after a complete successful refresh. Typed identities and season/episode coordinates remain distinct.
- Library/history snapshots use 500-item pages. Progress reads the documented latest-200 window, stated in the UI. Incremental writes/deletions batch at 500. A cancelled transfer may have completed previous batches; retries are idempotent.
- Full-document saves serialize in this client, refetch the complete document and compare against the reviewed baseline. Conflicts stop the write. Unknown fields are preserved. Nuvio does not document conditional writes, so this cannot eliminate a race with another client between the final read and write.
- The legacy `sync_push_library` full replacement is superseded by incremental library endpoints, following the docs' recommendation for new clients. Watchlist uploads add missing cloud entries; playback uploads retain newer remote clocks. Imports are additive and retain newer local playback. Cloud deletions never silently delete unrelated izumi data.
- IDs use native Stremio, IMDb or TMDB identities. Episode coordinates map to izumi's sequential video numbers; unmapped anime/season layouts are skipped. Nuvio milliseconds convert to izumi seconds. Standard IMDb/TMDB playback IDs can be constructed from known season/episode coordinates.
- Izumi stores watched-through counts. Sparse watched episodes that would falsely mark earlier unwatched episodes as complete are skipped and reported. Metadata must resolve through an available provider or a source already installed by the user; cloud URLs never install sources implicitly.
- Source transfers include configured URLs only on explicit user action. Every selected manifest is checked before installing any URLs. Query-based configuration follows the manifest path.
- Incognito playback is never exported. Library/playback transfers are unavailable while incognito is active.
- Preferences use a separate `izumi` platform namespace. Applying preferences allows only the existing portable-settings allowlist; tokens and device paths cannot be injected through a cloud document. Other client documents are separate.
- Local-to-cloud collections receive a stable `izumi:` prefix; re-adding updates the corresponding copy. Remote collection edits retain the raw document so fields unknown to izumi survive.

Live authenticated gallery reads, profile mutations and final device approval still need real-account acceptance testing. No real user's cloud data was changed during development.

The production build passed. Desktop/mobile fixture checks also verified profile creation and name-confirmed deletion, PIN blocking, collection creation with gallery artwork and save/reload, a season-two resume import, immediate preference saving with platform separation, inherited source changes, account health/supporter browsing, signup email confirmation and disconnect cleanup. At 390 × 844 the workspace and account-status view had no horizontal page overflow; scrollable navigation and tables remain contained.
