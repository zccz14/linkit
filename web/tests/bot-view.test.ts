import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { actAsPath } from "../src/lib/api.ts";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

const botViewConversation = (() => {
  const start = app.indexOf("function BotViewConversation");
  assert.ok(start >= 0, "BotViewConversation exists");
  return app.slice(start, start + 6_000);
})();

test("act-as read paths carry the bot user ID while the user's own session stays signed in", () => {
  assert.equal(
    actAsPath("/api/conversations", "bot-1"),
    "/api/conversations?act_as=bot-1",
  );
  assert.equal(
    actAsPath("/api/conversations/1/messages?before_cursor=x", "bot-1"),
    "/api/conversations/1/messages?before_cursor=x&act_as=bot-1",
  );
  assert.equal(
    actAsPath("/api/conversations", undefined),
    "/api/conversations",
  );
  assert.match(api, /actAs\?: string/);
});

test("the bots page switches into a bot view whose URL carries the bot state", () => {
  assert.match(app, /navigate\(`\/bots\/\$\{bot\.id\}\/conversations`\)/);
  assert.match(app, /path="\/bots\/:botId\/conversations"/);
  assert.match(app, /path="\/bots\/:botId\/conversations\/:conversationId"/);
});

test("the bot view reads as the bot and stays read-only", () => {
  assert.match(
    botViewConversation,
    /api<Conversation\[\]>\(sdk, "\/api\/conversations", \{\}, botId\)/,
  );
  assert.match(botViewConversation, /actAs=\{botId\}/);
  assert.doesNotMatch(botViewConversation, /method: "POST"/);
  assert.doesNotMatch(botViewConversation, /useMutation/);
  assert.match(app, /attachmentObjectUrl\(sdk, attachment\.id, actAs\)/);
});
