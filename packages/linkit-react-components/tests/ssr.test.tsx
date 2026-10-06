// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("auth-mini-react-components", () => ({
  useAuthMini: () => ({ isAuthenticated: false, isReady: false, sdk: undefined }),
}));

import { LinkitProvider, useLinkit } from "../src/index.js";

function ThemeProbe() {
  const { theme, resolvedTheme } = useLinkit();
  return <span>{`${theme}|${resolvedTheme}`}</span>;
}

describe("LinkitProvider without a DOM", () => {
  it("renders on the server and resolves the theme to the system default", () => {
    const html = renderToStaticMarkup(
      <LinkitProvider linkitBaseUrl="https://linkit.example.test">
        <ThemeProbe />
      </LinkitProvider>,
    );
    expect(html).toBe("<span>system|light</span>");
  });
});
