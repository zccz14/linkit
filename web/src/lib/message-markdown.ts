import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { safeMarkdownUrl } from "./message.ts";

export function MessageMarkdown({ children }: { children: string }) {
  return createElement(
    "div",
    {
      className:
        "text-sm leading-6 [&_code]:break-words [&_code]:rounded-sm [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8125em] [&_li+li]:mt-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/70 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
    },
    createElement(ReactMarkdown, {
      skipHtml: true,
      remarkPlugins: [remarkGfm],
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
