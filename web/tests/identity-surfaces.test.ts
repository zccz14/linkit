import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("identity surfaces resolve private notes through LinkitUserInfo", () => {
  for (const component of ["MessageRow", "GroupMemberRow", "ProfileCard"]) {
    const start = app.indexOf(`function ${component}`);
    const source = app.slice(start, start + 2_500);
    assert.ok(start >= 0, `${component} exists`);
    assert.match(source, /useLinkitUserInfo\(/);
    assert.match(source, /note\?\.name/);
  }
});
