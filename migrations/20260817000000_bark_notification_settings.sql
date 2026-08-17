CREATE TABLE bark_notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  device_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
