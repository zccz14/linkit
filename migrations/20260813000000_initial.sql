CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_meta(key,value) VALUES
  ('setup_complete','false'),
  ('root_user_id',''),
  ('auth_issuer',''),
  ('auth_audience',''),
  ('public_origin',''),
  ('max_upload_bytes','52428800');

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(username) BETWEEN 3 AND 32),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  motto TEXT NOT NULL DEFAULT '' CHECK(length(motto) <= 280),
  avatar_attachment_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('direct','group')),
  title TEXT NOT NULL DEFAULT '',
  direct_key TEXT UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('member','owner')),
  joined_at INTEGER NOT NULL,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(conversation_id,user_id)
);

CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversation_bots (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY(conversation_id,bot_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK(sender_kind IN ('user','bot')),
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 10000),
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_conversation_created ON messages(conversation_id,created_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  storage_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX attachments_message ON attachments(message_id);

CREATE TABLE notification_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

