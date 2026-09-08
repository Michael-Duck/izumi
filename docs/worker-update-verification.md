# Worker update verification

The installed client checks the linked Worker's public status after 20 seconds and every six hours.
It compares the reported version with `CLOUDFLARE_WORKER_VERSION`, rather than fetching repository
changes. The update action deploys the Worker bundled into the native app. A new Worker release
must therefore update the Worker package version, status version and client target together, then
regenerate the native bundle. The deployment contract test checks version alignment and the bundle
check detects changed build inputs.

Installation requires a fresh Cloudflare token on the device holding the deployment details.
The token is not persisted. A claimed temporary account retains its resources, but its temporary
credentials do not become permanent access; see Cloudflare's
[claim deployment documentation](https://developers.cloudflare.com/workers/platform/claim-deployments/).
Workers connected through another device or deployed through Git retain the documented manual
update path. This is automatic update detection with an owner-initiated installation.

Settings → Device sync → Sync & devices includes an **Update Worker** button whenever the device
has a linked Worker. It remains visible while sync is disabled or its connection check fails. The
button checks immediately, brings available installation steps into view, and confirms when no newer
bundled version exists. The token form is reserved for available updates, so this action does not
offer to downgrade a Worker that is newer than the installed client. Devices without saved deployment
details receive the guide and a reminder to update from the device that created the Worker.

The verification found and corrected these failure cases:

- Manual version checks swallowed network failures and could display success without a response.
- Deployment readiness accepted any Izumi status, including the old version during propagation.
- A delayed status response could restore old connection credentials or overwrite a changed setting.
- Native migration handling did not inspect individual SQL result failure flags inside a successful
  API envelope. The [D1 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
  exposes separate query result success flags. Failed queries now stop deployment before recording
  the migration or replacing the existing Worker.

Regression coverage exercises startup and periodic checks, older/current/newer version comparisons,
manual errors, invalid status versions, connection changes during a request, delayed deployment
propagation, migration failures, skipping completed migrations, repeat upgrades, the existing D1
binding, and preservation of existing device credentials and encrypted records through every migration.

Local API mocks and SQLite validate the code and migration behavior. They do not verify the current
state or permissions of a user's live Cloudflare account. Native deployment changes require a rebuilt
Izumi app; a frontend reload alone does not install them.

Verification on 2026-09-08 passed: 191 targeted JavaScript tests, 18 native deployment tests,
the bundle freshness check, and Svelte/TypeScript checking with zero errors or warnings.
The live temporary-account diagnostic remained ignored. The native test command ran from the
repository root with `C:\libmpv` added to `LIB` and `PATH`; the first attempt omitted that local
library path and failed to link `mpv.lib`.
