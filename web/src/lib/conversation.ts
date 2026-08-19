import type { ConversationDetail } from "@/lib/api";

export function renamedConversationDetail(
  conversation: ConversationDetail | undefined,
  title: string,
) {
  return conversation ? { ...conversation, title } : conversation;
}
