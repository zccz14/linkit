import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const bots = app.slice(
  app.indexOf("function Bots("),
  app.indexOf("function BotViewConversations"),
);

test("the bots control plane carries the owner-managed avatar", () => {
  assert.match(api, /export type Bot = \{[\s\S]*?avatar_attachment_id\?: string;/);
  assert.match(bots, /setBotAvatar\(result\.avatar_attachment_id \?\? ""\)/);
  assert.match(bots, /setBotAvatar\(bot\.avatar_attachment_id \?\? ""\)/);
});

test("the owner uploads an image and patches it onto the bot", () => {
  assert.match(bots, /const attachment = await upload\(sdk, file\)/);
  assert.match(bots, /body: \{ avatar_attachment_id: attachment\.id \}/);
  assert.match(bots, /body: \{ avatar_attachment_id: null \}/);
});

test("the bots page renders the stored avatar", () => {
  assert.match(bots, /avatar_attachment_id: bot\.avatar_attachment_id/);
  assert.match(bots, /htmlFor="bot-avatar"/);
  assert.match(bots, /t\("bots\.removeAvatar"\)/);
});
