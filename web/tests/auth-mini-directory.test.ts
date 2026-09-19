import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { supportedLocales, translate } from "../src/lib/locale.ts";

const source = readFileSync(
  new URL("../src/components/admin/auth-mini-directory.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("directory configuration keeps the token write-only and server-side", () => {
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="new-password"/);
  assert.match(source, /setToken\(""\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|\.data\??\.token/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /method: "DELETE"/);
});

test("directory configuration route is gated to the Root User", () => {
  assert.match(
    app,
    /path="\/admin\/auth-mini-directory"[\s\S]*?me\.root \? \([\s\S]*?<AuthMiniDirectory/,
  );
});

test("directory synchronization instructions and preservation boundary are translated", () => {
  for (const locale of supportedLocales) {
    assert.ok(translate(locale, "directorySync.instructions").includes("60"));
    assert.ok(translate(locale, "directorySync.boundary").includes("UUID"));
    assert.ok(translate(locale, "directorySync.confirmClear").length > 0);
  }
});
