# Restore a client from a TV

On Companion, open **Settings → Connection → Link phone or desktop**. Scan the QR
code with the phone camera, or open **Settings → Device sync → TV → Restore from TV**
in the full client and enter the Worker address and code. Reinstall the full client
first if necessary. Linking is started explicitly in the client; opening a QR link
does not change its setup.

The code is single-use and expires after ten minutes. Leaving the TV screen cancels
an unused code. A linked client receives its own device credentials and access to
the existing TV connection, preserving the TV identity and its previous client.
Households require the first unrestricted profile, including its PIN where set.
After linking, choose and unlock the restored profile before importing its progress.

The full client restores the saved TV source configuration, playback/catalogue
preferences, collections and household. Watch progress is a separate, retryable
merge. Previously shared full-client settings snapshots can also be selected when
encrypted sync recovery is available. Local-only files, downloads, and account
logins that were not saved are not recovered.

## Older installations

Worker **1.11.0**, the updated full client, and the updated Companion are required.
Update the private Worker through its existing deployment flow, applying migration
`0008_companion_client_links` before deploying the new Worker code. Native desktop
and mobile deployment include this migration; the Companion installer carries the
same Worker bundle and migrations.

Existing independently configured TVs can restore the setup and TV checkpoints
available in their private Worker. They cannot reconstruct a lost encryption key.
When that key is unavailable, the new client keeps full encrypted sync disabled and
shows the limited recovery notice. A valid invitation from another full client can
restore encrypted sync later. TV progress is bounded by the existing checkpoint
retention rules, so this is not an archive of everything ever watched.

To enable future encrypted-backup recovery, use an already configured full client
to complete **Link phone or desktop** once. The TV generates and retains a separate
random secret for its pairing and shares it only inside the encrypted reverse-link
payload. The existing full client preserves its same-Worker sync key and saves it
encrypted under that secret. Ordinary LAN pairing never transmits this secret.
The owner's device token is never copied. The recovery secret is separate from the
TV bearer token, which the Worker receives during normal authenticated requests.
Existing recovery envelopes are not replaced by later clients with a different
key; a retry must verify that the saved envelope contains the expected key.

## Protocol and verification

The TV generates a 100-bit code. Its SHA-256 digest authorizes a claim; the database
stores a second digest. The code itself stays in the QR fragment or manual input.
Polling sends the digest in a request header, never in the URL.
The TV identity is encrypted with AES-GCM using SHA-256 of a purpose-prefixed code
and authenticates the Worker origin. The recovery envelope uses a separate
client/TV secret and authenticates the pairing and recovery purpose.

Worker transactions register a fresh device and consume the invitation together.
Retries must prove the same recipient credentials. Cancellation, expiry, pairing
revocation and profile authorization changes invalidate outstanding grants. A saved
claim lets the client retry local restoration without consuming another code.

Tests cover encrypted handoff, secret separation, old-Worker compatibility,
single-use claims, retries, cancellation, household authorization, device identity,
recovery parsing and remote navigation. Browser previews check layout; these checks
do not substitute for a signed physical-TV installation and live private-Worker
recovery test.
