# Nuvio and Stremio on Companion

Worker 1.10.0 adds independent account libraries, collection folders and optional TV playback updates. Update the private Worker and install the corresponding Companion build before using this feature. Existing encrypted device sync remains available.

## Connect

1. In the full Izumi client, open **Settings → Device sync → TV** and enable independent TV playback.
2. Under **TV accounts**, connect Nuvio using the displayed device code at [Nuvio Link](https://nuvio.tv/link). This creates a separate session for the Worker. Choose an unlocked Nuvio profile and save it.
3. For Stremio, first sign in under **Settings → Accounts**, then choose **Connect Stremio** in TV accounts to explicitly share that session with the private Worker.
4. Enable **Use account sources** to include the account's Stremio add-ons. **Send TV playback** is a separate, initially disabled preference.
5. On the TV, select the Izumi logo to open the catalogue picker. Choose an account library, **Your collections**, or **Nuvio collections**. Collection groups open into folders with their configured covers or emoji. Back returns one level; **Load more titles** fetches another page.

Connections belong to the current Izumi profile and to the device that owns the TV pairing. Repeat setup for another Izumi profile. The TV must unlock that profile before browsing or sending playback updates. Nuvio profiles protected by a Nuvio PIN are unavailable because the public API does not document a compatible PIN unlock flow.

## What syncs

| Data | Behavior |
| --- | --- |
| Library | Read from Nuvio or Stremio; paginated TV browsing and library search |
| Continue watching | Account resume position, with milliseconds converted at the TV boundary |
| TV playback | Optional resume updates to connected accounts; newer remote item timestamps are preserved |
| Completion | Nuvio records completed watches through its watch-progress API; Stremio resume resets at completion, while its existing watched bitfield is preserved |
| Add-ons | Optional account Stremio manifests, including Nuvio's inherited primary-profile add-ons |
| Collections | User-imported local collections and the selected Nuvio profile's saved collection document |

The Worker resolves collection folders backed by installed Stremio catalogues or TMDB. Imports remain explicit user actions; community directories are not installed automatically. Browse and import community collections and covers in the full Izumi client, then reopen the TV picker. Trakt folders and JavaScript Nuvio/Omni providers currently require the full client; the Worker does not execute arbitrary provider scripts. Account library edits and Stremio watched-bitfield editing are not implemented on the TV.

## Storage and operation

Independent account operation requires readable credentials, source URLs and cached library data in the user's private D1 database. This is disclosed before connection. These records are separate from end-to-end encrypted device sync, and credentials never appear in TV responses. The TV checks playback opt-in before sending plaintext title/progress data. Disconnect removes the stored connection and cache; Nuvio also attempts session-local logout, while Stremio's shared desktop session is not revoked.

Account caches refresh after 60 seconds. Nuvio refresh-token rotation and writes use a D1 lease per owner/profile/service. Nuvio library snapshots capture the delta cursor before reading and replay concurrent changes, including deletions. TV sync bounds upstream responses to 8 MiB and account records to 1.8 MB; Nuvio libraries are limited to fewer than 5,000 items, recent progress to 200 snapshot entries and history to 500. Collections resolve at most eight sources per folder and 100 titles per source per page; unsupported sources report a visible folder error. Library pages contain 200 titles. Playback writes are best-effort while the TV is online, rather than a background account synchronization service.

Migration `0007_connected_accounts.sql` must be applied before uploading the Worker. Native deployment bundles include it; manual deployments should apply all pending migrations. The installer migration runner sends SQL intact and skips previously recorded migrations.

## Verification

Automated coverage uses SQLite-backed D1 fixtures and mocked upstream APIs for owner/profile isolation, TV PIN gating, refresh-token persistence, opt-in, timestamp conflicts, cursor replay, pagination and collection resolution. The account settings and TV folder navigation were also exercised in browser fixtures with simulated accounts. No live Nuvio/Stremio account mutations or physical-TV deployment were performed.

References: [Nuvio public API](https://nuvio.tv/docs/nuvio-public-api.md), [Nuvio collections](https://nuvio.tv/docs), [Stremio API request types](https://github.com/Stremio/stremio-core/blob/master/src/types/api/request.rs), [Stremio library item schema](https://github.com/Stremio/stremio-core/blob/master/src/types/library/library_item.rs).
