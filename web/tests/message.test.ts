import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { updatedConversationDetail } from "../src/lib/conversation.ts";
import { MessageMarkdown } from "../src/lib/message-markdown.ts";
import {
  safeMarkdownUrl,
  shouldSendMessageOnEnter,
} from "../src/lib/message.ts";

test("Enter sends only after IME composition completes", () => {
  assert.equal(
    shouldSendMessageOnEnter({
      key: "Enter",
      shiftKey: false,
      isComposing: false,
    }),
    true,
  );
  assert.equal(
    shouldSendMessageOnEnter({ key: "Enter", shiftKey: true, isComposing: false }),
    false,
  );
  assert.equal(
    shouldSendMessageOnEnter({ key: "Enter", shiftKey: false, isComposing: true }),
    false,
  );
  assert.equal(
    shouldSendMessageOnEnter({ key: "a", shiftKey: false, isComposing: false }),
    false,
  );
});

test("Markdown URLs only allow http, https, local paths, and fragment links", () => {
  assert.equal(safeMarkdownUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(safeMarkdownUrl("/attachments/file"), "/attachments/file");
  assert.equal(safeMarkdownUrl("#message"), "#message");
  assert.equal(safeMarkdownUrl("javascript:alert(1)"), "");
  assert.equal(safeMarkdownUrl("data:text/html,hello"), "");
  assert.equal(safeMarkdownUrl("file:///etc/passwd"), "");
});

test("message Markdown renders formatting and safe external links without raw HTML", () => {
  const html = renderToStaticMarkup(
    createElement(MessageMarkdown, {
      children:
        "**bold** and *italic* with `code`\n\n- first\n- second\n\n[Link](https://example.com) <img src=x onerror=alert(1)> [unsafe](javascript:alert(1))",
    }),
  );

  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul>/);
  assert.match(
    html,
    /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer"/,
  );
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /javascript:/);
});


test("renaming a group updates the loaded conversation cache without changing members", () => {
  const conversation = {
    id: "group",
    kind: "group" as const,
    title: "Before",
    created_by: "owner",
    created_at: 0,
    unread_count: 0,
    members: [{ user_id: "owner", username: "owner", display_name: "Owner", role: "owner" }],
    bots: [],
  };
  const renamed = updatedConversationDetail(conversation, { title: "After", avatar_attachment_id: undefined });
  assert.equal(renamed?.title, "After");
  assert.deepEqual(renamed?.members, conversation.members);
  assert.equal(updatedConversationDetail(undefined, { title: "After", avatar_attachment_id: undefined }), undefined);
});
