export type LinkitProfile = {
  user_id: string;
  username: string;
  avatar_url?: string | null;
  motto?: string | null;
  avatar_attachment_id?: string | null;
  updated_at?: number;
};

export type LinkitAttachment = {
  id: string;
  file_name: string;
  media_type: string;
  byte_size: number;
  created_at: number;
};

export type LinkitProfileUpdate = {
  username: string;
  motto: string;
  avatar_attachment_id?: string;
};

export type LinkitConversation = {
  id: string;
  kind: "direct" | "group";
  title?: string | null;
  avatar_url?: string | null;
  counterpart?: LinkitProfile | null;
  counterpart_name?: string | null;
  counterpart_avatar_attachment_id?: string | null;
};

export type LinkitMessage = {
  id: string;
  conversation_id: string;
  sender_kind: "user" | "bot";
  sender_id: string;
  sender_name: string;
  sender_deleted: boolean;
  body: string;
  urgent: boolean;
  created_at: number;
  attachments: LinkitAttachment[];
  cursor: string;
};

export type LinkitMessagePage = {
  messages: LinkitMessage[];
  older_cursor?: string | null;
  newer_cursor?: string | null;
};

export type LinkitMe = {
  id: string;
  root: boolean;
  profile?: LinkitProfile | null;
};

export type LinkitUserSearchResult = {
  user_id: string;
  username: string;
  avatar_url?: string | null;
};
