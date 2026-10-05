import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activeMentionToken,
  applyMention,
  mentionCandidates,
  replaceMentionTokens,
  splitMentionTokens,
  tokenizeMentions,
} from "../src/lib/mention.ts";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

const aliceId = "550e8400-e29b-41d4-a716-446655440001";
const customId = "550e8400-e29b-41d4-a716-446655440002";
const xiaomingId = "550e8400-e29b-41d4-a716-446655440003";
const bobId = "550e8400-e29b-41d4-a716-446655440004";
const bobbyId = "550e8400-e29b-41d4-a716-446655440005";

const members = [
  {
    user_id: aliceId,
    username: "Alice",
    user_type: "human" as const,
    has_profile: true,
  },
  {
    user_id: customId,
    username: "Custom Name",
    user_type: "human" as const,
    has_profile: true,
  },
  {
    user_id: xiaomingId,
    username: "小明",
    user_type: "human" as const,
    has_profile: true,
  },
  {
    user_id: bobId,
    username: "bob",
    user_type: "human" as const,
    has_profile: true,
  },
  {
    user_id: bobbyId,
    username: "bobby",
    user_type: "bot" as const,
    has_profile: true,
  },
];

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
  const candidates = [
    ...members,
    {
      user_id: "quiet",
      username: "quiet",
      user_type: "human" as const,
      has_profile: false,
    },
  ];
  assert.deepEqual(
    mentionCandidates(candidates, "", aliceId).map((member) => member.user_id),
    [customId, xiaomingId, bobId, bobbyId],
  );
  assert.deepEqual(
    mentionCandidates(candidates, "ALI", aliceId).map(
      (member) => member.user_id,
    ),
    [],
    "the sender is never suggested",
  );
  assert.deepEqual(
    mentionCandidates(candidates, "BO", aliceId).map(
      (member) => member.user_id,
    ),
    [bobId, bobbyId],
  );
  assert.deepEqual(
    mentionCandidates(candidates, "li", aliceId).map(
      (member) => member.user_id,
    ),
    [],
    "candidates filter by username prefix",
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

test("sending replaces typed mentions with user ID tokens", () => {
  assert.equal(
    tokenizeMentions("hello @Alice, ping @ALICE again", members),
    `hello <@${aliceId}>, ping <@${aliceId}> again`,
  );
  assert.equal(tokenizeMentions("@alice2", members), "@alice2");
  assert.equal(
    tokenizeMentions("mail bob@alice.com", members),
    "mail bob@alice.com",
  );
  assert.equal(
    tokenizeMentions("@Custom Name please", members),
    `<@${customId}> please`,
  );
  assert.equal(tokenizeMentions("@Custom Named", members), "@Custom Named");
  assert.equal(
    tokenizeMentions("的@小明 你好", members),
    `的<@${xiaomingId}> 你好`,
  );
  assert.equal(tokenizeMentions("@小明你好", members), "@小明你好");
  assert.equal(
    tokenizeMentions("thanks @bob.", members),
    `thanks <@${bobId}>.`,
  );
  assert.equal(tokenizeMentions("@bobby!", members), `<@${bobbyId}>!`);
  assert.equal(tokenizeMentions("@bobcat", members), "@bobcat");
});

test("message text splits into plain and mention segments by token", () => {
  const mentions = [
    { user_id: bobId, username: "bob" },
    { user_id: bobbyId, username: "bobby" },
  ];
  assert.deepEqual(
    splitMentionTokens(`ping <@${bobId}> and <@${bobbyId}>!`, mentions),
    [
      { text: "ping ", username: null },
      { text: "@bob", username: "bob" },
      { text: " and ", username: null },
      { text: "@bobby", username: "bobby" },
      { text: "!", username: null },
    ],
  );
  assert.deepEqual(
    splitMentionTokens(`ping <@${bobId.toUpperCase()}>`, mentions),
    [
      { text: "ping ", username: null },
      { text: "@bob", username: "bob" },
    ],
    "tokens match case-insensitively",
  );
  assert.deepEqual(
    splitMentionTokens(`hey <@${aliceId}>`, mentions),
    [{ text: `hey <@${aliceId}>`, username: null }],
    "tokens without a mention stay as written",
  );
  assert.deepEqual(splitMentionTokens("", mentions), []);
  assert.equal(replaceMentionTokens(`<@${bobId}>`, mentions), "@bob");
});

test("mention candidates show the avatar, private note and username", () => {
  const start = app.indexOf("function MentionOption");
  assert.ok(start >= 0, "MentionOption exists");
  const option = app.slice(start, start + 2_000);
  assert.match(option, /useLinkitUserInfo\(member\.user_id\)/);
  assert.match(
    option,
    /note\?\.name \|\| profile\?\.username \|\| member\.username/,
  );
  assert.match(option, /profile\?\.avatar_url/);
  assert.match(option, /@\{member\.username\}/);
});

test("the conversation composer sends tokenized mentions", () => {
  assert.match(app, /tokenizeMentions\(body, mentionableMembers\)/);
  assert.match(app, /const mentionableMembers = useMemo\(/);
});
