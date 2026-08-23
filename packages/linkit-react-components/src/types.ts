export type LinkitProfile = {
  user_id: string;
  username: string;
  display_name: string;
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
  display_name: string;
  motto: string;
  avatar_attachment_id?: string;
};

export type LinkitConversation = {
  id: string;
  kind: "direct" | "group";
  title?: string | null;
  avatar_url?: string | null;
  counterpart?: LinkitProfile | null;
};

export type LinkitMe = {
  id: string;
  root: boolean;
  profile?: LinkitProfile | null;
};

export type LinkitUserSearchResult = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
};
