import type { Conversation, ConversationDetail } from "@/lib/api";

export function updatedConversationDetail(
  conversation: ConversationDetail | undefined,
  update: Pick<Conversation, "title" | "avatar_attachment_id">,
) {
  return conversation ? { ...conversation, ...update } : conversation;
}
