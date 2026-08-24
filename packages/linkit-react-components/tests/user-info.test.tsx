import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = {
  isAuthenticated: true,
  sdk: { session: { getState: () => ({ accessToken: "access", expiresAt: "2999-01-01T00:00:00.000Z" }), refresh: async () => ({ accessToken: "fresh" }) } },
};

vi.mock("auth-mini-react-components", () => ({
  useAuthMini: () => auth,
}));

import { LinkitProvider, LinkitUserInfo } from "../src/index.js";

function renderInfo(props: Partial<React.ComponentProps<typeof LinkitUserInfo>> = {}) {
  return render(
    <LinkitProvider linkitBaseUrl="https://linkit.example.test">
      <LinkitUserInfo userId="550e8400-e29b-41d4-a716-446655440000" {...props} />
    </LinkitProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  auth.isAuthenticated = true;
});

describe("LinkitUserInfo", () => {
  it("renders username and complete user ID inline with an accessible profile popup", async () => {
    renderInfo({ profile: { user_id: "550e8400-e29b-41d4-a716-446655440000", username: "alice", motto: "Research first", avatar_url: "https://images.example.test/alice.webp" } });
    const trigger = screen.getByRole("button", { name: /user information: alice/i });
    expect(trigger).toHaveTextContent("alice");
    expect(trigger).toHaveTextContent("550e8400-e29b-41d4-a716-446655440000");
    fireEvent.click(trigger);
    expect(await screen.findByText("Research first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Message" })).toBeInTheDocument();
  });

  it("uses the localized unknown-user fallback and default user icon when no profile exists", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("profile unavailable"));
    renderInfo({ lang: "zh", profile: null });
    expect(screen.getByText("未知用户")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /用户资料: 未知用户/ });
    expect(trigger.querySelector("svg")).not.toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByText("该用户的 Linkit 资料不可用。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "私信" })).toBeDisabled();
  });

  it("loads a missing profile only after opening the popup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user_id: "550e8400-e29b-41d4-a716-446655440000", username: "alice", motto: "Hi", avatar_url: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    renderInfo();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /user information: unknown user/i }));
    expect((await screen.findAllByText("alice")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("https://linkit.example.test/api/public/profiles/550e8400-e29b-41d4-a716-446655440000");
  });

  it("opens a Linkit direct conversation without putting an access token in the URL", async () => {
    const opened = { opener: {} as Window | null, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(opened);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "viewer", root: false, profile: null }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "conversation-1", kind: "direct" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    renderInfo({ profile: { user_id: "550e8400-e29b-41d4-a716-446655440000", username: "alice", motto: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /user information: alice/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Message" }));
    await waitFor(() => expect(opened.location.replace).toHaveBeenCalledWith("https://linkit.example.test/#/conversations/conversation-1"));
  });

  it("rejects messaging yourself and closes the provisional window", async () => {
    const opened = { opener: {} as Window | null, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(opened);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "550e8400-e29b-41d4-a716-446655440000", root: false, profile: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    renderInfo({ profile: { user_id: "550e8400-e29b-41d4-a716-446655440000", username: "alice", motto: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /user information: alice/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Message" }));
    expect(await screen.findByText("You can't send a direct message to yourself.")).toBeInTheDocument();
    expect(opened.close).toHaveBeenCalled();
  });
});
