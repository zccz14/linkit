import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const manage = app.slice(
  app.indexOf("function GroupManagementContent"),
  app.indexOf("function GroupMemberRow"),
);

test("the manage panel lists a member's own bots that are not in the group yet", () => {
  assert.match(manage, /queryKey: \["bots"\]/);
  assert.match(
    manage,
    /const availableBots = \(bots\.data \?\? \[\]\)\.filter\(/,
  );
  assert.match(
    manage,
    /!detail\.members\.some\(\(member\) => member\.user_id === bot\.id\)/,
  );
  assert.match(manage, /\{availableBots\.length \? \(/);
  assert.match(manage, /\{t\("conversation\.addBot"\)\}/);
});

test("adding a bot reuses the membership endpoint with the bot's user id", () => {
  assert.match(
    manage,
    /api\(sdk, `\/api\/conversations\/\$\{detail\.id\}\/members`, \{/,
  );
  assert.match(manage, /body: JSON\.stringify\(\{ user_id: botId \}\),/);
  assert.match(manage, /onClick=\{\(\) => addBot\.mutate\(bot\.id\)\}/);
  assert.match(manage, /toast\.success\(t\("conversation\.addBotSuccess"\)\)/);
});
