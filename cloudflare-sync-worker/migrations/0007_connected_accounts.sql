-- Dedicated, opt-in external account sessions. Never part of encrypted device records.
CREATE TABLE IF NOT EXISTS connected_accounts (
  owner_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('nuvio', 'stremio')),
  connection_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_device_id, profile_id, service)
);
