import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("identity surfaces resolve private notes through LinkitUserInfo", () => {
  for (const component of [
    "ConversationListItem",
    "MessageRow",
    "GroupMemberRow",
    "ProfileCard",
  ]) {
    const start = app.indexOf(`function ${component}`);
    const source = app.slice(start, start + 2_500);
    assert.ok(start >= 0, `${component} exists`);
    assert.match(source, /useLinkitUserInfo\(/);
    assert.match(source, /note\?\.name/);
  }
});

test("conversation list receives the counterpart user ID needed for private notes", () => {
  const api = readFileSync(
    new URL("../src/lib/api.ts", import.meta.url),
    "utf8",
  );
  assert.match(api, /counterpart_user_id\?: string/);
  assert.match(app, /conversation\.counterpart_user_id/);
});
