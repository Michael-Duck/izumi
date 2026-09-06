# Nuvio and Omni sources

In **Settings → Sources → Manage**, paste either:

- A Nuvio provider repository's `manifest.json` URL, raw GitHub directory URL ending in `/`, or GitHub repository/file URL.
- A configured Stremio add-on manifest URL or `stremio://` install link copied from Nuvio or Omni.

GitHub shorthand (`owner/repo` or `gh:owner/repo`) tries the existing `index.json` layout first, then Nuvio's `manifest.json`. The app starts with no configured sources. Repository and individual provider switches use the existing Sources controls.

## Compatibility

Nuvio repositories contain a `scrapers` array. Entries supply `id`, `filename`, `supportedTypes` (`movie` and/or `tv`), and optional display metadata. Standalone entries and arrays of entries also work. Entries explicitly disabled by the repository, non-video entries, and non-JavaScript payloads are skipped. IDs are scoped to the repository so two forks with the same scraper IDs can coexist.

Bundled CommonJS providers run inside izumi's existing isolated extension workers. The host supplies `fetch`, `Buffer`, `CryptoJS`, `SCRAPER_ID`, `SCRAPER_SETTINGS`, and `require()` for `cheerio-without-node-native`, `react-native-cheerio`, `cheerio`, `crypto-js`, `axios`, `buffer`, and `url`. Axios requests use the same native HTTP bridge as other extensions. Relative source-code imports must be bundled by the provider author. Native Node modules, browser-page/WebView automation, binary HTTP responses, and Nuvio's custom provider settings UI are not supported by this compatibility layer. Manifest-supplied settings and provider defaults are available. These limitations can affect individual providers even when their manifests import successfully.

Providers receive `getStreams(tmdbId, 'movie')` or `getStreams(tmdbId, 'tv', season, episode)`. TMDB catalogue IDs and native episode addressing are preserved; AniList titles use AniZip mappings. Missing TMDB IDs or season mappings produce a provider message rather than a query for an unrelated title. Metadata with only an IMDb ID needs a TMDB mapping before it can use Nuvio JavaScript providers. Stremio add-ons retain their existing supported ID formats.

Direct HTTP results retain quality, server labels, request headers, subtitle URLs and headers, explicit audio metadata, and HLS/DASH identity. No audio language is inferred just because a provider returned a URL. Results are delivered as each provider finishes, and a failing provider does not discard its siblings' results. Continue Watching uses the existing online-extension source identity. Existing resolved-stream playback contracts remain unchanged.

Omni's documented add-on interface is the Stremio protocol, so its configured add-on links use izumi's existing Stremio path. This does not import Omni account settings, groups, or full profile exports. Nuvio account sign-in and collection browsing are available separately through [Browse Nuvio](./nuvio-account.md).

## References

- [Nuvio provider format and module contract](https://github.com/yoruix/nuvio-providers/blob/template/README.md)
- [Example Nuvio repository manifest](https://github.com/yoruix/nuvio-providers/blob/main/manifest.json)
- [Omni add-on setup and Stremio compatibility](https://omni-help.github.io/)

Compatibility tests use synthetic providers and fixture manifests; they do not rely on third-party media availability.
