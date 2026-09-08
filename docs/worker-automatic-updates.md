# Worker automatic updates

Worker 1.12.0 adds authenticated GET/POST update routes for owner devices and paired TVs.
The same coordinator runs from a six-hour scheduled handler. It checks the official stable
release manifest and triggers a private Cloudflare Builds deploy hook only for a newer Worker.

The hook URL lives only in the encrypted `WORKER_DEPLOY_HOOK` runtime binding. Clients cannot
configure a URL, select code, change a branch, or receive this credential through the endpoint.
D1 metadata provides an atomic lease shared across isolates. Successful and ambiguous build
requests are throttled for six hours; version checks are throttled for five minutes. Queued,
delayed, failed, unconfigured, and confirmed-current states remain distinct.

The stable release workflow attaches a small manifest and a checksummed Worker package before
publishing the release. Cloudflare's build helper follows the official versioned artifact, so a
user's fork does not need to track upstream commits for normal runtime updates. Deployment keeps
the existing D1 binding and secrets, reconciles native and Wrangler migration ledgers, and installs
the cron trigger. A failed migration stops deployment. New protocol or resource requirements
outside package schema 1 may require a later setup change.

The TV update screen uses its existing pairing credential, polls pending status, cancels its
HTTP request on exit, and never treats build acceptance as proof of installation. An older
Worker falls back to the setup guide. Desktop/mobile uses the same owner endpoint when available.
Existing installations require one production build and hook configuration to bootstrap this
capability; an old runtime cannot grant itself deployment authority.

## Reference and setup

- [Cloudflare Deploy Hooks](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)
  documents tokenless POST triggering, URL secrecy, idempotency, and scheduled triggering.
- [Build authorization](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)
  documents Cloudflare-generated build tokens and their default permissions. D1 Edit must be added
  once for database migrations; users do not copy that token into a client.
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)
  documents retaining dashboard variables and secrets during deployment.
- The user-facing setup procedure is in `cloudflare-sync-worker/README.md`, under Updating.

Local automated checks cover authentication, revoked pairings, concurrent requests, scheduled
operation, pause behavior, error redaction, throttling, stable versions, checksum rejection,
migration ordering, failure before deployment, and TV request cancellation. Cloudflare-account
setup and physical-TV installation remain deployment checks, not claims made by these tests.
