import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = { missing: false };
afterEach(() => cleanup());
vi.mock("auth-mini-react-components", () => ({
  AuthMiniProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthMini: () => {
    if (state.missing) throw new Error("missing auth");
    return { sdk: { session: { getState: () => ({ accessToken: "access", expiresAt: "2999-01-01T00:00:00.000Z" }), refresh: async () => ({ accessToken: "fresh" }) } } };
  },
}));

import { AuthMiniProvider } from "auth-mini-react-components";
import { LinkitAvatar, LinkitConversationDisplay, LinkitProvider, LinkitUserDisplay, useLinkit } from "../src/index.js";

function Consumer() {
  const { linkitBaseUrl } = useLinkit();
  return <span>{linkitBaseUrl}</span>;
}

describe("LinkitProvider", () => {
  it("reports a Linkit-specific provider nesting error", () => {
    state.missing = true;
    expect(() => render(<LinkitProvider linkitBaseUrl="https://linkit.example.test"><Consumer /></LinkitProvider>)).toThrow("LinkitProvider must be rendered inside AuthMiniProvider.");
    state.missing = false;
  });

  it("exposes Linkit API context inside AuthMiniProvider", () => {
    render(<AuthMiniProvider authMiniBaseUrl="https://auth.example.test" autoRedirectToLogin={false}><LinkitProvider linkitBaseUrl="https://linkit.example.test"><Consumer /></LinkitProvider></AuthMiniProvider>);
    expect(screen.getByText("https://linkit.example.test")).toBeInTheDocument();
  });
});

describe("Linkit displays", () => {
  it("renders compact user and group fallbacks accessibly", () => {
    render(<><LinkitAvatar profile={{ display_name: "Alice" }} /><LinkitUserDisplay userId="user-1" compact /><LinkitConversationDisplay conversation={{ id: "group-1", kind: "group", title: "Research" }} /></>);
    expect(screen.getByLabelText("Alice")).toHaveTextContent("A");
    expect(screen.getByText("Unknown user")).toBeInTheDocument();
    expect(screen.getByText("user-1")).toHaveAttribute("title", "user-1");
    expect(screen.getByText("Research")).toBeInTheDocument();
  });

  it("keeps profile identity and username ahead of the fallback identifier", () => {
    render(<LinkitUserDisplay userId="user-1" showUsername profile={{ user_id: "user-1", display_name: "Alice", username: "alice" }} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.queryByText("user-1")).not.toBeInTheDocument();
  });
});

it("未知 profile 可使用本地化标签并保留完整用户 ID", () => {
  render(<LinkitUserDisplay userId="550e8400-e29b-41d4-a716-446655440000" unknownLabel="未知用户" />);
  expect(screen.getByText("未知用户")).toBeInTheDocument();
  expect(screen.getByText("550e8400-e29b-41d4-a716-446655440000")).toBeInTheDocument();
});
