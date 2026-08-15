CREATE TABLE bark_devices (
  key_hash TEXT PRIMARY KEY,
  device_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
