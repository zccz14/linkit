CREATE TABLE profiles_next (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(username) BETWEEN 1 AND 80),
  motto TEXT NOT NULL DEFAULT '' CHECK(length(motto) <= 280),
  avatar_attachment_id TEXT,
  updated_at INTEGER NOT NULL
);

INSERT INTO profiles_next(user_id,username,motto,avatar_attachment_id,updated_at)
SELECT user_id,username,motto,avatar_attachment_id,updated_at FROM profiles;

DROP TABLE profiles;
ALTER TABLE profiles_next RENAME TO profiles;
