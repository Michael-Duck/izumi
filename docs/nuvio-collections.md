# Nuvio collections and covers

Researched against Nuvio's website and `NuvioMedia/NuvioMobile` (`cmp-rewrite`) on 6 September 2026.

## How users add them in Nuvio

- [Community Covers](https://nuvio.tv/covers): open a cover, then choose **Copy Raw URL**. The result is an image URL for a profile, collection folder, or custom row. The library page itself is not an image or source manifest.
- [Community collections](https://nuvio.tv/community-collections): open a collection and choose **Add to profile** (or **Add pack**). The dialog selects a profile and an install mode: add as new, merge, or overwrite. Its add-on preflight checks the catalogs against installed and included manifests. The final Add collection button saves to the selected Nuvio profile.
- [Account → Collections](https://nuvio.tv/account?tab=collections) provides **Export**, **Import**, and **Share JSON**. Export or Share JSON after adding the desired community collection. Some community pages also provide creator-supplied JSON resources; check whether these contain collections or a separate AIOMetadata/Xperience configuration.
- Nuvio's community detail API returned HTTP 401 without authentication. A community page URL is not an anonymously downloadable collection manifest. Izumi now offers its own Nuvio connection and browser; see [Nuvio account integration](./nuvio-account.md).

## Add to izumi

For direct browsing, open **Settings → Catalog → Collections & covers → Browse Nuvio** and connect your account. Select community collections, covers, or collections from Nuvio profiles inside izumi. The file workflow remains available:

1. Open **Settings → Catalog → Collections & covers**.
2. Choose an exported JSON file, paste its JSON, or paste a direct HTTP(S) JSON file URL. Select **Preview import**.
3. Review collection/folder counts and dependencies. Community envelopes may include optional add-on manifests; explicitly select the ones to install. Izumi checks their manifest IDs, required catalogs, and declared genres before saving.
4. Select **Import collections**. Matching collection IDs are updated, including artwork; unrelated collections remain. A repeated import does not create duplicate IDs.
5. Open Home, then a collection folder. Stremio catalog references use enabled add-ons from Sources. TMDB sources use the izumi TMDB Read Access Token; Trakt lists use the connected Trakt account.
6. To change artwork, expand the imported collection in settings, select **Edit cover**, and paste the result of Nuvio's **Copy Raw URL**. Portrait, landscape, square, hidden labels, and optional focus GIFs are supported.

Collections appear below the hero on all online Home screens. Only opening a folder requests its catalog feeds. Results use the existing media detail and playback routes. Missing dependencies are reported per catalog, allowing other catalogs in that folder to remain usable. Home collection settings are shared across local profiles, like the other Home preferences; results respect the active profile's content restrictions. The preference participates in manual device snapshots and app backups.

## Compatibility

Accepted formats:

- Nuvio's exported collection array.
- A single collection object with `id`, `title`, and `folders`.
- Community envelopes containing `collection` or `collections` (individual or pack).
- A collection sync object with a `collections_json` array.

Folders use modern `sources` when populated, otherwise legacy `catalogSources`. Add-on sources identify `addonId`, `type`, `catalogId`, and optional `genre`. Matching follows Nuvio's declared add-on preference, comma-suffix legacy fallback within that add-on, then exact catalog/type matching in other enabled add-ons. An imported source cannot independently fetch or enable a manifest.

TMDB supports LIST, COLLECTION, COMPANY, NETWORK, DISCOVER, PERSON (cast), and DIRECTOR (directing credits). Discover preserves Nuvio's genre, company, network, date, year, language, country, keyword, rating, vote count, and watch-provider filters. Unknown filters fail explicitly instead of broadening the results. Trakt list requests include media type, sort order, and page/limit. Stremio catalogs paginate when their manifest declares `skip`.

Imports are snapshots. Re-add from the Nuvio browser or import a fresh export to update. Background two-way Nuvio profile sync and external configuration tools are not connected. The folder browser supports tabbed grids and catalog rows; FOLLOW_LAYOUT uses izumi's grid. Folder videos and Nuvio-specific TV hero behavior are not implemented. Image URLs (including GIFs) remain remote references; no artwork is bundled or downloaded by the import operation. Focus animations respect reduced-motion preferences.

Imports are bounded to 8 MB, 200 collections, 2,000 folders, and 10,000 catalog references per file. Duplicate IDs, malformed catalog references, and non-HTTP(S) image URLs are rejected or excluded before rendering. An empty export is not installed.

## Primary references

- [Nuvio CollectionModels.kt](https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/commonMain/kotlin/com/nuvio/app/features/collection/CollectionModels.kt)
- [Nuvio CollectionRepository.kt](https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/commonMain/kotlin/com/nuvio/app/features/collection/CollectionRepository.kt) — JSON array export/import and validation.
- [Nuvio CollectionCatalogResolver.kt](https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/commonMain/kotlin/com/nuvio/app/features/collection/CollectionCatalogResolver.kt) — catalog matching.
- [Nuvio TmdbCollectionSourceResolver.kt](https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/commonMain/kotlin/com/nuvio/app/features/collection/TmdbCollectionSourceResolver.kt) — TMDB paths and filter translations.
- Nuvio website controls inspected in the signed-in browser; its publicly served community JavaScript defines envelopes with `schemaVersion`, `type`, `collection`/`collections`, `requirements.addons`, and optional `community`/`resources` metadata.
- [Trakt API pagination and sorting changes](https://github.com/trakt/trakt-api/discussions/681).

## Validation

Automated tests cover export formats, legacy sources, malformed/duplicate input, dependency validation, catalog identity resolution, filter preservation, artwork URL validation, TMDB and Trakt mapping, pagination, and cancellation. Live provider playback is outside this import test; playback continues through the existing source system.

The targeted regression run passed 171 tests (one pre-existing skipped test). Svelte checks reported no errors or warnings, and the production build passed. Browser checks in an isolated local session covered importing an array, opening its folders, missing TMDB configuration feedback, editing and saving a real Nuvio cover URL, and rendering mixed portrait/landscape folder cards on Home. The Nuvio account was only inspected; no collections or add-ons were installed there.
