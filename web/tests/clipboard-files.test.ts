import assert from "node:assert/strict";
import test from "node:test";

import { clipboardFiles, isGifMediaType } from "../src/lib/clipboard-files.ts";

const file = (name: string) => ({ name }) as File;

test("clipboard files prefer the browser file list", () => {
  const first = file("chart.png");
  const fallback = file("ignored.pdf");
  assert.deepEqual(
    clipboardFiles({
      files: [first],
      items: [{ kind: "file", getAsFile: () => fallback }],
    }),
    [first],
  );
});

test("clipboard files fall back to file items", () => {
  const image = file("screen.gif");
  const document = file("notes.pdf");
  assert.deepEqual(
    clipboardFiles({
      files: [],
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => image },
        { kind: "file", getAsFile: () => document },
      ],
    }),
    [image, document],
  );
});

test("GIF media types use the animated image presentation", () => {
  assert.equal(isGifMediaType("image/gif"), true);
  assert.equal(isGifMediaType("IMAGE/GIF; charset=binary"), true);
  assert.equal(isGifMediaType("image/png"), false);
});
