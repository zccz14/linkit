import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const groupCreator = app.slice(
  app.indexOf("function GroupCreator"),
  app.indexOf("function Bots", app.indexOf("function GroupCreator")),
);

test("GroupCreator uses the package-owned controlled multi user picker and submits selected IDs", () => {
  assert.match(groupCreator, /<LinkitUserPicker\s+multiple/);
  assert.match(groupCreator, /value=\{memberIds\}/);
  assert.match(groupCreator, /onValueChange=\{\(userIds\) => setMemberIds\(userIds\)\}/);
  assert.match(groupCreator, /user_ids:\s*memberIds/);
  assert.doesNotMatch(groupCreator, /usernames/);
  assert.doesNotMatch(groupCreator, /split\(/);
});
