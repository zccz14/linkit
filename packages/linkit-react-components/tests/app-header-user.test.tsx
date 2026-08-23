import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  isReady: true,
  isAuthenticated: true,
  signIn: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  sdk: { session: { getState: () => ({ accessToken: "access", expiresAt: "2999-01-01T00:00:00.000Z" }), refresh: vi.fn().mockResolvedValue({ accessToken: "fresh" }) } },
};

vi.mock("auth-mini-react-components", () => ({
  AuthMiniButton: ({ labels }: { labels?: { signedIn?: string } }) => <button type="button">{labels?.signedIn ?? "Account"}</button>,
  useAuthMini: () => auth,
}));

import { LinkitAppHeaderUser, LinkitProvider } from "../src/index.js";

beforeEach(() => {
  auth.isReady = true;
  auth.isAuthenticated = true;
  auth.signIn.mockReset();
  auth.signOut.mockReset().mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/me") return json({ id: "uid-1", root: false, profile: { user_id: "uid-1", username: "alice", display_name: "Alice", motto: "Hello", avatar_attachment_id: "avatar-1" } });
    if (path === "/api/public/profiles/uid-1") return json({ user_id: "uid-1", username: "alice", display_name: "Alice", motto: "Hello", avatar_url: "https://cdn.example.test/alice.webp" });
    if (path === "/api/profile" && init?.method === "PUT") return json({ user_id: "uid-1", username: "alice-next", display_name: "Alice Next", motto: "Updated", avatar_attachment_id: "avatar-1" });
    return new Response("not found", { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function json(body: unknown) { return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }); }
function subject() { return <LinkitProvider linkitBaseUrl="https://linkit.example.test"><LinkitAppHeaderUser lang="en" /></LinkitProvider>; }

describe("LinkitAppHeaderUser", () => {
  it("shows the signed-in avatar/name and saves the profile in its dialog", async () => {
    render(subject());
    await screen.findByRole("button", { name: /Alice/ });
    fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByDisplayValue("alice")).toBeInTheDocument();
    expect(screen.getByText("uid-1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice-next" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alice Next" } });
    fireEvent.change(screen.getByLabelText("Motto"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/profile"), expect.objectContaining({ method: "PUT" }));
  });

  it("uses the existing Auth Mini login flow while signed out", () => {
    auth.isAuthenticated = false;
    render(subject());
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it("keeps the Auth Mini security surface composed inside the profile dialog and signs out", async () => {
    render(subject());
    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    expect(screen.getByRole("button", { name: "Account security" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
  });
});
