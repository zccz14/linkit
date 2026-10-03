import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const preview = readFileSync(
  new URL("../src/components/image-preview.tsx", import.meta.url),
  "utf8",
);

const attachmentView = (() => {
  const start = app.indexOf("function AttachmentView");
  assert.ok(start >= 0, "AttachmentView exists");
  return app.slice(start, start + 2_000);
})();

test("chat image attachments render as app-side thumbnails, not new tabs", () => {
  assert.match(
    app,
    /import \{ ImagePreview \} from "@\/components\/image-preview";/,
  );
  assert.match(
    attachmentView,
    /<ImagePreview src=\{url\} name=\{attachment\.file_name\} \/>/,
  );
  assert.doesNotMatch(attachmentView, /_blank/);
  assert.doesNotMatch(attachmentView, /target=/);
  assert.doesNotMatch(app, /isGifMediaType/);
});

test("the thumbnail opens an in-app lightbox that closes without leaving the conversation", () => {
  assert.match(preview, /t\("attachment\.viewImage"\)/);
  assert.match(preview, /t\("attachment\.closeImage"\)/);
  assert.match(preview, /max-h-80/);
  assert.match(preview, /<Dialog open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.match(preview, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(preview, /DialogPrimitive\.Popup/);
  assert.doesNotMatch(preview, /_blank/);
  assert.doesNotMatch(preview, /target=/);
  assert.doesNotMatch(preview, /<a[\s>]/);
});
