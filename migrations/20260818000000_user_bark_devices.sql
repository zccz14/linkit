DROP TABLE IF EXISTS bark_notification_settings;
DROP TABLE IF EXISTS bark_devices;

CREATE TABLE bark_user_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE bark_user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_key_hash TEXT NOT NULL UNIQUE,
  device_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX bark_user_devices_user ON bark_user_devices(user_id,updated_at);
