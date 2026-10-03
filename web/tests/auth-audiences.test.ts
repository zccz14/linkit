import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("hosted sign-in asks Auth Mini for the site audience and the serving hostname", () => {
  assert.match(
    app,
    /new Set\(\["linkit\.ntnl\.io", window\.location\.hostname\]\)/,
  );
  assert.match(app, /audiences=\{AUTH_AUDIENCES\}/);
});
