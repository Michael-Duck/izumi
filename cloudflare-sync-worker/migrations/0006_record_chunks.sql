ALTER TABLE records ADD COLUMN chunk_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE record_chunks (
  category TEXT NOT NULL,
  device_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (category, device_id, chunk_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX record_chunks_age ON record_chunks(device_id, category, updated_at);
