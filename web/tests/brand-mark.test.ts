import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markSvg = readFileSync(
  new URL("../public/linkit-mark.svg", import.meta.url),
  "utf8",
);
const markComponent = readFileSync(
  new URL("../src/components/linkit-mark.tsx", import.meta.url),
  "utf8",
);
const indexHtml = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("the favicon mark is a square outline with a light and dark palette", () => {
  assert.match(markSvg, /rect \{ stroke: #000; \}/);
  assert.match(
    markSvg,
    /@media \(prefers-color-scheme: dark\) \{\s*rect \{ stroke: #fff; \}/,
  );
  assert.match(
    markSvg,
    /<rect x="13\.5" y="13\.5" width="37" height="37" fill="none" stroke-width="9" stroke-linejoin="round" \/>/,
  );
});

test("the sidebar renders the square mark in the theme foreground color", () => {
  assert.match(markComponent, /stroke="currentColor"/);
  assert.match(markComponent, /strokeWidth="9"/);
  assert.match(markComponent, /x="13\.5"/);
  assert.match(markComponent, /width="37"/);
  assert.match(app, /<LinkitMark className="size-7 shrink-0" \/>/);
  assert.doesNotMatch(app, /linkit-logo\.png/);
});

test("the favicon links the SVG mark instead of the retired PNG", () => {
  assert.match(
    indexHtml,
    /<link rel="icon" type="image\/svg\+xml" sizes="any" href="\/linkit-mark\.svg" \/>/,
  );
  assert.doesNotMatch(indexHtml, /favicon-64\.png/);
});

test("the favicon re-renders in the resolved theme without a reload", () => {
  const favicon = readFileSync(
    new URL("../src/lib/favicon.ts", import.meta.url),
    "utf8",
  );
  const themeProvider = readFileSync(
    new URL("../src/components/theme-provider.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    favicon,
    /LINKIT_MARK_RECT = \{ x: 13\.5, y: 13\.5, width: 37, height: 37 \}/,
  );
  assert.match(favicon, /light: "#000",[\s\S]*dark: "#fff"/);
  assert.match(favicon, /data:image\/svg\+xml/);
  assert.match(themeProvider, /applyFavicon\(resolvedTheme\)/);
});
