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
      className:
        "text-sm leading-6 [&_code]:break-words [&_code]:rounded-sm [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8125em] [&_li+li]:mt-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/70 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
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
