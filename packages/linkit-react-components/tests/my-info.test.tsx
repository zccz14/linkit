import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let publicAvatarVersion = 1;
let publicProfileStatus = 200;
let unreadTotal = 3;
let myLang = "";
let myTheme = "system";
let profileSaveStatus = 200;
let eventStream: ReadableStreamDefaultController<Uint8Array> | undefined;

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

import { LinkitMyInfo, LinkitProvider, useLinkit } from "../src/index.js";

beforeEach(() => {
  auth.isReady = true;
  auth.isAuthenticated = true;
  auth.signIn.mockReset();
  auth.signOut.mockReset().mockResolvedValue(undefined);
  auth.openPasskeyRegistrationPage.mockReset();
  publicAvatarVersion = 1;
  publicProfileStatus = 200;
  unreadTotal = 3;
  myLang = "";
  myTheme = "system";
  profileSaveStatus = 200;
  eventStream = undefined;
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.removeProperty("color-scheme");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/me") return json({ id: "uid-1", root: false, profile: { user_id: "uid-1", username: "alice", intro: "Hello", lang: myLang, theme: myTheme, avatar_attachment_id: "avatar-1" } });
    if (path === "/api/public/profiles/uid-1") return publicProfileStatus === 200
      ? json({ user_id: "uid-1", username: "alice", intro: "Hello", avatar_url: `https://cdn.example.test/alice.webp?v=${publicAvatarVersion}` })
      : new Response(JSON.stringify({ error: { message: "Public profile unavailable" } }), { status: publicProfileStatus, headers: { "content-type": "application/json" } });
    if (path === "/api/unread-count") return json({ total: unreadTotal });
    if (path === "/api/events") return eventStreamResponse();
    if (path === "/api/profile" && init?.method === "PUT") {
      if (profileSaveStatus !== 200) return new Response(JSON.stringify({ error: { message: "Theme save failed" } }), { status: profileSaveStatus, headers: { "content-type": "application/json" } });
      publicAvatarVersion = 2;
      const body = JSON.parse(String(init.body)) as { lang?: string; theme?: string };
      return json({ user_id: "uid-1", username: "alice-next", intro: "Updated", lang: body.lang ?? "", theme: body.theme ?? "system", avatar_attachment_id: "avatar-1" });
    }
    return new Response("not found", { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function json(body: unknown) { return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }); }
function eventStreamResponse() {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { eventStream = controller; },
  }), { headers: { "content-type": "text/event-stream" } });
}
function emitServerEvent(name: string, data: unknown) {
  eventStream?.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
}
function subject(lang = "en") { return <LinkitProvider lang={lang} linkitBaseUrl="https://linkit.example.test"><LinkitMyInfo /></LinkitProvider>; }
function LanguageProbe() {
  const { lang, languages } = useLinkit();
  return <span data-testid="language-probe">{`${lang}|${languages.join(",")}`}</span>;
}
function saveBody() {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([input, init]) => String(input).includes("/api/profile") && (init as RequestInit | undefined)?.method === "PUT");
  const call = calls[calls.length - 1];
  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
}

function controllableMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  let current = matches;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return current; },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
    addListener: (listener: () => void) => { listeners.add(listener); },
    removeListener: (listener: () => void) => { listeners.delete(listener); },
    dispatchEvent: () => false,
  }));
  return {
    set(next: boolean) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("LinkitMyInfo", () => {
  it("shows the signed-in avatar/name and saves the profile in its dialog", async () => {
    render(subject());
    await screen.findByRole("button", { name: /alice/ });
    fireEvent.click(screen.getByRole("button", { name: /alice/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alice")).toBeInTheDocument();
    expect(screen.getByText("uid-1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice-next" } });
    fireEvent.change(screen.getByLabelText("Introduction"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeInTheDocument());
    expect(screen.getByDisplayValue("alice-next")).toBeInTheDocument();
    expect(Array.from((fetch as ReturnType<typeof vi.fn>).mock.calls).filter(([input]) => String(input).includes("/api/public/profiles/uid-1")).length).toBe(2);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/profile"), expect.objectContaining({ method: "PUT" }));
  });

  it("reads the public avatar without attaching the Auth Mini bearer token", async () => {
    render(subject());
    await screen.findByRole("button", { name: /alice/ });
    await waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([input]) => String(input).includes("/api/public/profiles/uid-1"))).toBe(true));
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input]) => String(input).includes("/api/public/profiles/uid-1"));
    expect(call?.[1]).toBeUndefined();
  });

  it("shows an avatar fallback and a recoverable error when the public profile request fails", async () => {
    publicProfileStatus = 500;
    render(subject());
    const trigger = await screen.findByRole("button", { name: /alice/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Public profile unavailable"));
    expect(trigger.querySelector("img")).toBeNull();
    expect(trigger.querySelector(".linkit-my-info__avatar-fallback")).toHaveTextContent("A");
  });

  it("uses the existing Auth Mini login flow while signed out", () => {
    auth.isAuthenticated = false;
    render(subject());
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it("reads its language from LinkitProvider", () => {
    auth.isAuthenticated = false;
    render(subject("zh-CN"));
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("exposes the stored language priority list and prefers it for its own copy", async () => {
    myLang = "zh-CN,en-US";
    render(<LinkitProvider lang="en" linkitBaseUrl="https://linkit.example.test"><LanguageProbe /><LinkitMyInfo /></LinkitProvider>);
    await waitFor(() => expect(screen.getByTestId("language-probe")).toHaveTextContent("zh-CN|zh-CN,en-US"));
    fireEvent.click(await screen.findByRole("button", { name: /alice/ }));
    expect(screen.getByText("账户")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "语言" })).toHaveTextContent("中文");
  });

  it("saves the language chosen in the profile dialog", async () => {
    myLang = "en";
    render(subject());
    fireEvent.click(await screen.findByRole("button", { name: /alice/ }));
    const select = screen.getByRole("combobox", { name: "Language" });
    expect(select).toHaveTextContent("English");
    fireEvent.click(select);
    const chinese = await screen.findByRole("option", { name: "中文" });
    fireEvent.pointerDown(chinese, { pointerType: "mouse" });
    fireEvent.click(chinese);
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeInTheDocument());
    expect(saveBody().lang).toBe("zh-CN");
    expect(select).toHaveTextContent("中文");
  });

  it("shows the unread count, follows pushed unread events, and opens the Linkit inbox", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(subject());
    const inbox = await screen.findByRole("button", { name: "Open Linkit messages (3 unread messages)" });
    expect(screen.getByText("3")).toBeInTheDocument();
    emitServerEvent("unread", { total: 5 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Linkit messages (5 unread messages)" })).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([input]) => String(input).includes("/api/conversations"))).toBe(false);
    fireEvent.click(inbox);
    expect(open).toHaveBeenCalledWith("https://linkit.example.test/#/", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("reconciles the unread count after the event stream drops", async () => {
    render(subject());
    await screen.findByRole("button", { name: "Open Linkit messages (3 unread messages)" });
    unreadTotal = 9;
    eventStream?.close();
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Open Linkit messages (9 unread messages)" })).toBeInTheDocument(),
      { timeout: 4_000 },
    );
  });

  it("cycles the theme preference from the header button and saves it immediately", async () => {
    render(subject());
    await screen.findByRole("button", { name: /alice/ });
    fireEvent.click(screen.getByRole("button", { name: "Dark mode: Follow system (default)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dark mode: Always dark" })).toBeEnabled());
    expect(saveBody().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dark mode: Always dark" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dark mode: Always light" })).toBeEnabled());
    expect(saveBody().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Dark mode: Always light" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dark mode: Follow system (default)" })).toBeEnabled());
    expect(saveBody().theme).toBe("system");
  });

  it("reverts the header theme when the save fails and surfaces the error in the dialog", async () => {
    profileSaveStatus = 500;
    render(subject());
    await screen.findByRole("button", { name: /alice/ });
    fireEvent.click(screen.getByRole("button", { name: "Dark mode: Follow system (default)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dark mode: Follow system (default)" })).toBeEnabled());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /alice/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Theme save failed"));
  });

  it("edits the theme preference in the profile dialog and saves it with the profile", async () => {
    render(subject());
    fireEvent.click(await screen.findByRole("button", { name: /alice/ }));
    const select = screen.getByRole("combobox", { name: "Dark mode" });
    expect(select).toHaveTextContent("Follow system (default)");
    fireEvent.click(select);
    const option = await screen.findByRole("option", { name: "Always dark" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeInTheDocument());
    expect(saveBody().theme).toBe("dark");
    expect(select).toHaveTextContent("Always dark");
  });

  it("applies the stored theme to the document and mirrors it for the next reload", async () => {
    myTheme = "dark";
    render(subject());
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("linkit.theme")).toBe("dark");
  });

  it("follows the system scheme while the stored preference is system", async () => {
    const media = controllableMedia(false);
    render(subject());
    await screen.findByRole("button", { name: /alice/ });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    media.set(true);
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    media.set(false);
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
  });

  it("prefers the mirrored theme until the signed-in profile resolves", async () => {
    window.localStorage.setItem("linkit.theme", "dark");
    render(subject());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("organizes Auth Mini security actions inside its own dialog and signs out", async () => {
    render(subject());
    fireEvent.click(await screen.findByRole("button", { name: /alice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    expect(auth.openPasskeyRegistrationPage).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Manage sign-in methods" })).toHaveAttribute("href", "https://auth.example.test/web/#/");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
  });
});
