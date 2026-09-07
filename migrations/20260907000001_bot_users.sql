ALTER TABLE users ADD COLUMN type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human','bot'));

UPDATE users
SET type='bot'
WHERE id IN (SELECT id FROM bots);

INSERT OR IGNORE INTO users(id,type,created_at)
SELECT id,'bot',created_at
FROM bots;

INSERT OR IGNORE INTO conversation_members(conversation_id,user_id,role,joined_at)
SELECT conversation_id,bot_id,'member',added_at
FROM conversation_bots;

DROP TABLE conversation_bots;

CREATE TABLE bots_new (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO bots_new(id,owner_user_id,name,token_prefix,token_hash,created_at,updated_at)
SELECT id,owner_user_id,name,token_prefix,token_hash,created_at,updated_at
FROM bots;

DROP TABLE bots;
ALTER TABLE bots_new RENAME TO bots;
CREATE INDEX bots_owner_created ON bots(owner_user_id,created_at DESC);
