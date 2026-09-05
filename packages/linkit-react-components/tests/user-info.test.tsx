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

const alice = {
  user_id: "550e8400-e29b-41d4-a716-446655440000",
  username: "alice",
  motto: "Research first",
  avatar_url: "https://images.example.test/alice.webp",
};

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderInfo(props: { lang?: string; userId?: string; compact?: boolean } = {}) {
  return render(
    <LinkitProvider lang={props.lang} linkitBaseUrl="https://linkit.example.test">
      <LinkitUserInfo compact={props.compact} userId={props.userId ?? alice.user_id} />
    </LinkitProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  auth.isAuthenticated = true;
});

describe("LinkitUserInfo", () => {
  it("renders the Provider-cached profile and complete user ID inline with an accessible popup", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json([alice]));
    renderInfo();
    const trigger = await screen.findByRole("button", { name: /user information: alice/i });
    expect(trigger).toHaveTextContent("alice");
    expect(trigger).toHaveTextContent(alice.user_id);
    fireEvent.click(trigger);
    expect(await screen.findByText("Research first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Message" })).toBeInTheDocument();
  });

  it("uses the Provider locale and internal unknown-user copy when no profile exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
    renderInfo({ lang: "zh" });
    const trigger = await screen.findByRole("button", { name: /用户资料: 未知用户/ });
    expect(trigger.querySelector("svg")).not.toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByText("该用户的 Linkit 资料不可用。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "私信" })).toBeDisabled();
  });

  it("batches distinct user IDs and deduplicates repeated IDs before requesting profiles", async () => {
    const bob = { ...alice, user_id: "660e8400-e29b-41d4-a716-446655440000", username: "bob" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([alice, bob]));
    render(
      <LinkitProvider linkitBaseUrl="https://linkit.example.test">
        <LinkitUserInfo userId={alice.user_id} />
        <LinkitUserInfo compact userId={bob.user_id} />
        <LinkitUserInfo compact userId={alice.user_id} />
      </LinkitProvider>,
    );
    await screen.findByRole("button", { name: /user information: bob/i });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://linkit.example.test/api/public/profiles/batch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ user_ids: [alice.user_id, bob.user_id] }),
      }),
    );
  });

  it("does not issue a second request for an ID while its batch is in flight", async () => {
    let resolveBatch: (response: Response) => void = () => undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise((resolve) => { resolveBatch = resolve; }),
    );
    const subject = (duplicate = false) => <LinkitProvider linkitBaseUrl="https://linkit.example.test">
      <LinkitUserInfo userId={alice.user_id} />
      {duplicate ? <LinkitUserInfo compact userId={alice.user_id} /> : null}
    </LinkitProvider>;
    const rendered = render(subject());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rendered.rerender(subject(true));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveBatch(json([alice]));
    expect((await screen.findAllByRole("button", { name: /user information: alice/i })).length).toBe(2);
  });

  it("always opens a Linkit direct conversation without putting an access token in the URL", async () => {
    const opened = { opener: {} as Window | null, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(opened);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json([alice]))
      .mockResolvedValueOnce(json({ id: "viewer", root: false, profile: null }))
      .mockResolvedValueOnce(json({ id: "conversation-1", kind: "direct" }));
    renderInfo();
    fireEvent.click(await screen.findByRole("button", { name: /user information: alice/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Message" }));
    await waitFor(() => expect(opened.location.replace).toHaveBeenCalledWith("https://linkit.example.test/#/conversations/conversation-1"));
  });

  it("rejects messaging yourself and closes the provisional window", async () => {
    const opened = { opener: {} as Window | null, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(opened);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json([alice]))
      .mockResolvedValueOnce(json({ id: alice.user_id, root: false, profile: null }));
    renderInfo();
    fireEvent.click(await screen.findByRole("button", { name: /user information: alice/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Message" }));
    expect(await screen.findByText("You can't send a direct message to yourself.")).toBeInTheDocument();
    expect(opened.close).toHaveBeenCalled();
  });
});
