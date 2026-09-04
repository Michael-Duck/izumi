# Trakt application registration

For the current native device-code connection:

| Field | Value |
| --- | --- |
| Name | Izumi |
| Description | Connect your Trakt account to Izumi to sync watch history, watchlists and ratings, and discover movies and shows. |
| Redirect URIs | `urn:ietf:wg:oauth:2.0:oob` |
| JavaScript (CORS) origins | Leave empty; requests use Izumi's native HTTP transport. |

Paste the issued Client ID and Client secret into Settings → Accounts → Trakt. Do not commit either credential. They are stored locally per profile, not distributed with the application or included in device sync. An installed application cannot keep an embedded app secret confidential.

The current flow does not use an HTTPS callback or `izumi://` redirect. For a future desktop/mobile authorization-code flow, implement a dedicated HTTPS callback on a domain we control, validate a cryptographically random one-time state, and offer an explicit Open Izumi handoff. Do not put access tokens or secrets into a handoff URL. TV should retain device authorization. Register the exact deployed callback path only after implementing it; the domain homepage alone is not a callback.

Reference: https://docs.trakt.tv/reference/auth (checked 2026-09-04).
