import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("desktop shell keeps all sidebar regions reachable through one internal scroller", () => {
  assert.match(
    app,
    /<div className="grid h-dvh min-h-0 grid-cols-\[17rem_1fr\] overflow-hidden bg-muted\/30 max-md:grid-cols-1">/,
  );
  assert.match(
    app,
    /<aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r bg-background p-4 max-md:hidden">/,
  );
  assert.match(
    app,
    /<div>\{conversationList\}<\/div>\s*<div className="mt-auto flex items-center gap-2 border-t pt-4">/,
  );
  assert.doesNotMatch(app, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(
    app,
    /<main className="min-h-0 min-w-0 overflow-y-auto">\s*<Routes>/,
  );
});
