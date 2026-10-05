import assert from "node:assert/strict";
import test from "node:test";

import {
  activeMentionToken,
  applyMention,
  mentionCandidates,
  splitMentions,
} from "../src/lib/mention.ts";

test("the composer tracks the mention token around the caret", () => {
  assert.deepEqual(activeMentionToken("hello @bo", 9), {
    start: 6,
    query: "bo",
  });
  assert.deepEqual(activeMentionToken("just @", 6), { start: 5, query: "" });
  assert.deepEqual(activeMentionToken("的@小", 3), { start: 1, query: "小" });
  assert.equal(activeMentionToken("mail bob@alice", 14), null);
  assert.equal(activeMentionToken("no token here", 8), null);
  assert.equal(activeMentionToken("@x\ny", 4), null);
  assert.equal(activeMentionToken(`@${"a".repeat(81)}`, 82), null);
});

test("mention candidates are members with profiles other than the sender", () => {
  const members = [
    {
      user_id: "me",
      username: "me",
      user_type: "human" as const,
      has_profile: true,
    },
    {
      user_id: "alice",
      username: "Alice",
      user_type: "human" as const,
      has_profile: true,
    },
    {
      user_id: "fund-bot",
      username: "Fund Bot",
      user_type: "bot" as const,
      has_profile: true,
    },
    {
      user_id: "quiet",
      username: "quiet",
      user_type: "human" as const,
      has_profile: false,
    },
  ];
  assert.deepEqual(
    mentionCandidates(members, "", "me").map((member) => member.user_id),
    ["alice", "fund-bot"],
  );
  assert.deepEqual(
    mentionCandidates(members, "ALI", "me").map((member) => member.user_id),
    ["alice"],
  );
  assert.deepEqual(
    mentionCandidates(members, "li", "me").map((member) => member.user_id),
    [],
  );
});

test("applying a mention replaces the token and leaves room to keep typing", () => {
  assert.deepEqual(applyMention("hi @bo", { start: 3, query: "bo" }, "bob"), {
    value: "hi @bob ",
    caret: 8,
  });
  assert.deepEqual(
    applyMention("@bo there", { start: 0, query: "bo" }, "bob"),
    {
      value: "@bob there",
      caret: 4,
    },
  );
});

test("message text splits into plain and mention segments", () => {
  assert.deepEqual(splitMentions("ping @Bob and @bobby!", ["bob", "bobby"]), [
    { text: "ping ", username: null },
    { text: "@Bob", username: "bob" },
    { text: " and ", username: null },
    { text: "@bobby", username: "bobby" },
    { text: "!", username: null },
  ]);
  assert.deepEqual(splitMentions("not @bobcat", ["bob"]), [
    { text: "not @bobcat", username: null },
  ]);
  assert.deepEqual(splitMentions("mail bob@alice.com", ["alice"]), [
    { text: "mail bob@alice.com", username: null },
  ]);
  assert.deepEqual(splitMentions("的@小明 好", ["小明"]), [
    { text: "的", username: null },
    { text: "@小明", username: "小明" },
    { text: " 好", username: null },
  ]);
  assert.deepEqual(splitMentions("", ["bob"]), []);
});
