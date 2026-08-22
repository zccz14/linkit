CREATE TABLE avatar_derivatives (
  source_attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK(media_type = 'image/webp'),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  width INTEGER NOT NULL CHECK(width = 256),
  height INTEGER NOT NULL CHECK(height = 256),
  source_byte_size INTEGER NOT NULL CHECK(source_byte_size >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
