import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let publicAvatarVersion = 1;

const auth = {
  authMiniBaseUrl: "https://auth.example.test",
  error: null,
  isReady: true,
  isAuthenticated: true,
  signIn: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  openPasskeyRegistrationPage: vi.fn(),
  sdk: { session: { getState: () => ({ accessToken: "access", expiresAt: "2999-01-01T00:00:00.000Z" }), refresh: vi.fn().mockResolvedValue({ accessToken: "fresh" }) } },
};

vi.mock("auth-mini-react-components", () => ({ useAuthMini: () => auth }));

import { LinkitAppHeaderUser, LinkitProvider } from "../src/index.js";

beforeEach(() => {
  auth.isReady = true;
  auth.isAuthenticated = true;
  auth.signIn.mockReset();
  auth.signOut.mockReset().mockResolvedValue(undefined);
  auth.openPasskeyRegistrationPage.mockReset();
  publicAvatarVersion = 1;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/me") return json({ id: "uid-1", root: false, profile: { user_id: "uid-1", username: "alice", display_name: "Alice", motto: "Hello", avatar_attachment_id: "avatar-1" } });
    if (path === "/api/public/profiles/uid-1") return json({ user_id: "uid-1", username: "alice", display_name: "Alice", motto: "Hello", avatar_url: `https://cdn.example.test/alice.webp?v=${publicAvatarVersion}` });
    if (path === "/api/profile" && init?.method === "PUT") { publicAvatarVersion = 2; return json({ user_id: "uid-1", username: "alice-next", display_name: "Alice Next", motto: "Updated", avatar_attachment_id: "avatar-1" }); }
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
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alice")).toBeInTheDocument();
    expect(screen.getByText("uid-1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice-next" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alice Next" } });
    fireEvent.change(screen.getByLabelText("Motto"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeInTheDocument());
    expect(Array.from((fetch as ReturnType<typeof vi.fn>).mock.calls).filter(([input]) => String(input).includes("/api/public/profiles/uid-1")).length).toBe(2);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/profile"), expect.objectContaining({ method: "PUT" }));
  });

  it("uses the existing Auth Mini login flow while signed out", () => {
    auth.isAuthenticated = false;
    render(subject());
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it("organizes Auth Mini security actions inside its own dialog and signs out", async () => {
    render(subject());
    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    expect(auth.openPasskeyRegistrationPage).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Manage sign-in methods" })).toHaveAttribute("href", "https://auth.example.test/web/#/");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
  });
});
