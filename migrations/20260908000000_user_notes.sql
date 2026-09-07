CREATE TABLE user_notes (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(owner_user_id,target_user_id)
);
