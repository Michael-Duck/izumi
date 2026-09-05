# Trakt application registration

For the desktop/mobile browser connection, register the website callback exactly (no trailing slash):

| Field | Value |
| --- | --- |
| Name | Izumi |
| Description | Connect your Trakt account to Izumi to sync watch history, watchlists and ratings, and discover movies and shows. |
| Redirect URIs | `https://izumi.watch/link/trakt` |
| JavaScript (CORS) origins | Leave empty; requests use Izumi's native HTTP transport. |

Paste the issued Client ID and Client secret into Settings → Accounts → Trakt. Do not commit either credential. They are stored locally per profile, not distributed with the application or included in device sync. An installed application cannot keep an embedded app secret confidential.

## How the connection works

1. Izumi creates a random, ten-minute, profile-bound state and PKCE S256 verifier. The short-lived transaction stays in local storage so an app restart does not lose it; it is not synced.
2. The app opens Trakt in the system browser with `https://izumi.watch/link/trakt` as `redirect_uri`.
3. The site removes the authorization query from browser history and offers **Open Izumi**, handing a temporary code and state to `izumi://auth/trakt#…`. No tokens, client secret, or PKCE verifier are sent to the site.
4. Izumi validates the pending state, profile, client registration and expiry; consumes the request; then exchanges the code directly with Trakt using the same HTTPS redirect and the PKCE verifier.
5. If the app does not reopen, use **Copy return link** on the site and **App didn’t reopen?** in Izumi’s Trakt connection form. Treat this temporary link as private.

The registered URI is the HTTPS site URL, **not** the internal `izumi://` handoff. CORS origins are not redirect URIs; no browser API calls are used in this flow.

## Rollout

- Deploy the sibling `anAnimeThemeForStremio-site` repository to the Cloudflare Pages project serving `izumi.watch`. Check `/link/trakt` returns the connection page with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- Install an updated native Izumi build, enter the Trakt app credentials in the desired profile, and run a real approval/return test. Existing installed builds only support device authorization and cannot complete this new handoff.
- The static site needs no secrets or environment variables. Do not deploy the client secret into JavaScript or commit it to either repository. This implementation retains user-supplied, device-local credentials; a centrally managed client credential would require a separate server-side design.
- Existing device-code sessions keep their saved redirect for refresh until they reconnect with the browser flow. Keep `urn:ietf:wg:oauth:2.0:oob` as a second registered URI if this same Trakt application still serves device authentication or older clients. TV device authorization is unchanged.
- Automated tests cover local request validation and mocked exchanges. A deployed website and real Trakt credentials are required to verify the provider/OS handoff end to end.

References: [Trakt OAuth](https://docs.trakt.tv/reference/auth), [authorize](https://docs.trakt.tv/reference/getoauthauthorize), [token exchange](https://docs.trakt.tv/reference/postoauthtoken), [provider metadata advertising S256](https://auth.trakt.tv/.well-known/openid-configuration) (checked 2026-09-05).
