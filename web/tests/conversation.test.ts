import assert from "node:assert/strict";
import test from "node:test";

import { updatedConversationDetail } from "../src/lib/conversation.ts";

test("updating a group avatar preserves the loaded group members and bots", () => {
  const detail = {
    id: "group",
    kind: "group" as const,
    title: "Before",
    avatar_attachment_id: undefined,
    created_by: "owner",
    created_at: 0,
    unread_count: 0,
    members: [{ user_id: "owner", username: "owner", display_name: "Owner", role: "owner" }],
    bots: [],
  };
  const updated = updatedConversationDetail(detail, {
    title: "After",
    avatar_attachment_id: "group-avatar",
  });
  assert.equal(updated?.title, "After");
  assert.equal(updated?.avatar_attachment_id, "group-avatar");
  assert.deepEqual(updated?.members, detail.members);
  assert.deepEqual(updated?.bots, detail.bots);
});
