import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };

test("unauthenticated first render shares the Auth Mini context with the source-aliased Linkit provider", () => {
  assert.match(
    app,
    /<AuthMiniProvider[\s\S]*?<LinkitProvider[\s\S]*?<AuthedApp\s*\/>[\s\S]*?<\/LinkitProvider>[\s\S]*?<\/AuthMiniProvider>/,
  );
  assert.match(
    viteConfig,
    /dedupe:\s*\[[\s\S]*?["']auth-mini-react-components["'][\s\S]*?["']react["'][\s\S]*?["']react-dom["'][\s\S]*?\]/,
  );
  assert.equal(packageJson.dependencies["auth-mini-react-components"], "^0.6.2");
});
