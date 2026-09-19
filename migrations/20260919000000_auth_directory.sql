CREATE TABLE auth_directory_sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL DEFAULT '',
  last_synced_at INTEGER,
  user_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
INSERT INTO auth_directory_sync(id) VALUES(1);

CREATE INDEX users_id_nocase ON users(id COLLATE NOCASE);
