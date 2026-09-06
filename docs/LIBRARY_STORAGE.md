# Library storage and large-library sync

Watch history and saved-library entries now live in the `izumi-library-v1` IndexedDB database.
History uses one row per title. The saved library splits entries and deletion records into
individual rows while preserving list order, queues, and other metadata. Updates write only
changed rows; history is never trimmed to make it fit in localStorage.

The first launch migrates each active profile's existing `local-history` and
`local-media-library-v1` values. The old value is removed only after the database transaction
commits. Profile-specific names remain unchanged. Other profiles migrate when opened. Route
loading waits for hydration; edits arriving during hydration are replayed against the loaded
state. Profile switching waits for pending writes. Removing a profile also removes its database
collections.

Application backups include database collections from every profile using the existing version-1
JSON keys. Legacy backups restore directly into IndexedDB without consuming localStorage quota.
If a write fails, the app reports it and the backup path includes unsaved active-profile values.
The database is personal data and is not included in the disposable cache-clearing commands.

Cloudflare Worker 1.9 adds the `0006_record_chunks.sql` migration. Payloads above 360 KiB use
authenticated encrypted chunks and an encrypted manifest. Requests remain below the 512 KiB
body limit, while the assembled snapshot may be up to 32 MiB. Content-defined chunk boundaries
reuse unaffected ciphertext after small edits; unchanged snapshots are not rewritten in the same
client session. The manifest is committed only when all chunks exist. Checksum, AES-GCM, and total
size validation finish before any reconstructed record reaches the merge functions.

Small cloud records retain their existing format. Old Workers receive a clear update-required
message for large libraries. Older clients cannot read multipart records and should be updated
alongside the Worker. The Samsung TV snapshot/checkpoint protocol is unchanged. Iroh already
transfers content-addressed blobs; its application payload ceiling is now the same 32 MiB.

Current limits: startup still hydrates a full active-profile library in memory; JSON snapshots
still require serialization before chunking. This change removes localStorage quota and whole-map
disk-write pressure, and the cloud request-size ceiling. It does not claim unlimited libraries or
database-paginated UI queries. Abrupt OS termination can interrupt the most recent asynchronous
write; completed transactions and failed-migration source data remain intact.
