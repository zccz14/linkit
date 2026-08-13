ALTER TABLE messages ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;
UPDATE messages SET sequence=rowid;
CREATE UNIQUE INDEX messages_sequence ON messages(sequence);
CREATE INDEX messages_conversation_cursor ON messages(conversation_id,created_at,sequence);
CREATE TABLE message_sequences (sequence INTEGER PRIMARY KEY AUTOINCREMENT);
INSERT INTO message_sequences(sequence) SELECT sequence FROM messages;
