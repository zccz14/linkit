import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translate } from "../src/lib/locale.ts";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

const page = (() => {
  const start = app.indexOf("function ApiKeys");
  assert.ok(start >= 0, "ApiKeys exists");
  return app.slice(start, start + 5_500);
})();

test("the API keys page manages personal keys through the user API key routes", () => {
  assert.match(api, /export type UserApiKey = \{/);
  assert.match(page, /api<UserApiKey\[\]>\(sdk, "\/api\/user-api-keys"\)/);
  assert.match(
    page,
    /api<\{ token: string \}>\(sdk, "\/api\/user-api-keys", \{/,
  );
  assert.match(page, /api<void>\(sdk, `\/api\/user-api-keys\/\$\{id\}`/);
  assert.match(page, /method: "POST"/);
  assert.match(page, /method: "DELETE"/);
});

test("the created key is revealed once and revoking asks for confirmation", () => {
  assert.match(page, /setToken\(created\.token\)/);
  assert.match(page, /readOnly value=\{token\}/);
  assert.match(page, /setRevokeConfirmation\(true\)/);
  assert.doesNotMatch(page, /localStorage/);
});

test("the API keys route and navigation entry are wired", () => {
  assert.match(app, /path="\/settings\/api-keys"/);
  assert.match(app, /to: "\/settings\/api-keys"/);
});

test("both locales describe personal API keys", () => {
  for (const key of [
    "navigation.apiKeys",
    "apiKeys.title",
    "apiKeys.description",
    "apiKeys.revokeTitle",
  ] as const) {
    assert.ok(translate("en", key).length > 0);
    assert.ok(translate("zh-CN", key).length > 0);
  }
});
