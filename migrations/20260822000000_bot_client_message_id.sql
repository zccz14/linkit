ALTER TABLE messages ADD COLUMN client_message_id TEXT;
CREATE UNIQUE INDEX messages_bot_client_message_id
  ON messages(conversation_id,sender_id,client_message_id)
  WHERE sender_kind='bot' AND client_message_id IS NOT NULL;
