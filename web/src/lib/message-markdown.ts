import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { MessageMention } from "./api.ts";
import { safeMarkdownUrl } from "./message.ts";
import { replaceMentionTokens, splitMentionTokens } from "./mention.ts";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
  };
};

const mentionClassName =
  "rounded-sm bg-current/15 px-0.5 font-medium [box-decoration-break:clone]";

export function MessageMarkdown({
  children,
  mentions = [],
}: {
  children: string;
  mentions?: MessageMention[];
}) {
  return createElement(
    "div",
    {
      // 版式来自 @zccz14/ux 的 .ux-markdown，与家族里其它 Markdown 面完全一致；
      // 这里保留自己的插件链，因为消息里的 @mention 是 Linkit 的领域概念。
      className: "ux-markdown text-sm",
    },
    createElement(ReactMarkdown, {
      skipHtml: true,
      remarkPlugins: [remarkGfm, [remarkMentions, mentions]],
      urlTransform: safeMarkdownUrl,
      components: {
        a: ({ children, href }) =>
          href
            ? createElement(
                "a",
                {
                  href,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  className: "font-medium underline underline-offset-2",
                },
                children,
              )
            : createElement("span", null, children),
      },
      children,
    }),
  );
}

function remarkMentions(mentions: MessageMention[]) {
  return (tree: MarkdownNode) => {
    highlightMentions(tree, mentions);
  };
}

function highlightMentions(node: MarkdownNode, mentions: MessageMention[]) {
  // The composer converts mention text even inside code spans, so code spans
  // substitute tokens back to `@username` to keep what the sender wrote.
  if (
    (node.type === "code" || node.type === "inlineCode") &&
    typeof node.value === "string"
  ) {
    node.value = replaceMentionTokens(node.value, mentions);
    return;
  }
  if (!Array.isArray(node.children)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text" || typeof child.value !== "string") {
      highlightMentions(child, mentions);
      return [child];
    }
    return splitMentionTokens(child.value, mentions).map((segment) =>
      segment.username === null
        ? { type: "text", value: segment.text }
        : {
            type: "text",
            value: segment.text,
            data: {
              hName: "span",
              hProperties: {
                className: mentionClassName,
                "data-mention": segment.username,
              },
            },
          },
    );
  });
}
