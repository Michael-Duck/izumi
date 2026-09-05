PRAGMA foreign_keys = ON;

-- Separate bounded journal: recommendation feedback cannot evict playback checkpoints.
-- A profile-scoped opaque digest identifies each record; all content is encrypted by clients.
CREATE TABLE companion_discovery (
  pairing_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  choice_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pairing_id, media_key),
  FOREIGN KEY (pairing_id) REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE
);
CREATE INDEX companion_discovery_updated ON companion_discovery(pairing_id, updated_at DESC);
