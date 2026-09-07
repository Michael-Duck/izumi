PRAGMA foreign_keys = ON;

-- Only failed full-client household authorizations consume this per-TV window.
ALTER TABLE companion_pairings ADD COLUMN client_link_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_pairings ADD COLUMN client_link_retry_at INTEGER NOT NULL DEFAULT 0;

-- A link token is already a digest on the wire; only its second digest is stored.
-- Consumed rows retain the encrypted payload until expiry for authenticated retries.
CREATE TABLE companion_client_links (
  token_hash TEXT PRIMARY KEY,
  pairing_id TEXT NOT NULL REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  authorization_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_device_id TEXT REFERENCES devices(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX companion_client_links_waiting ON companion_client_links(pairing_id)
  WHERE consumed_device_id IS NULL;
CREATE INDEX companion_client_links_expiry ON companion_client_links(expires_at);

CREATE TABLE companion_client_members (
  pairing_id TEXT NOT NULL REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (pairing_id, device_id)
);
CREATE INDEX companion_client_members_device ON companion_client_members(device_id);

-- Encrypted with a separate client/TV recovery key, never the bearer capability.
-- The Worker stores only the opaque envelope and cannot read the group key.
CREATE TABLE companion_client_recovery (
  pairing_id TEXT PRIMARY KEY REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);

-- A profile save invalidates pending authorizations even if its contents are later restored.
CREATE TRIGGER companion_client_links_profile_insert AFTER INSERT ON resolver_profiles BEGIN
  DELETE FROM companion_client_links WHERE consumed_device_id IS NULL AND pairing_id IN
    (SELECT pairing_id FROM companion_pairings WHERE owner_device_id = NEW.owner_device_id);
END;
CREATE TRIGGER companion_client_links_profile_update AFTER UPDATE ON resolver_profiles BEGIN
  DELETE FROM companion_client_links WHERE consumed_device_id IS NULL AND pairing_id IN
    (SELECT pairing_id FROM companion_pairings WHERE owner_device_id IN (OLD.owner_device_id, NEW.owner_device_id));
END;
CREATE TRIGGER companion_client_links_profile_delete AFTER DELETE ON resolver_profiles BEGIN
  DELETE FROM companion_client_links WHERE consumed_device_id IS NULL AND pairing_id IN
    (SELECT pairing_id FROM companion_pairings WHERE owner_device_id = OLD.owner_device_id);
END;
CREATE TRIGGER companion_client_links_pairing_update AFTER UPDATE OF owner_device_id, tv_token_hash ON companion_pairings BEGIN
  DELETE FROM companion_client_links WHERE pairing_id = OLD.pairing_id;
END;
