import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

const viewerUserId = "11111111-1111-4111-8111-111111111111";
const otherViewerUserId = "22222222-2222-4222-8222-222222222222";

function tokenForSubject(subject: string) {
  const payload = btoa(JSON.stringify({ sub: subject }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${payload}.signature`;
}

let accessToken = tokenForSubject(viewerUserId);
const auth = {
  isAuthenticated: true,
  sdk: {
    session: {
      getState: () => ({ accessToken, expiresAt: "2999-01-01T00:00:00.000Z" }),
      refresh: async () => ({ accessToken }),
    },
  },
  signOut: vi.fn(async () => {
    auth.isAuthenticated = false;
  }),
};

vi.mock("auth-mini-react-components", () => ({
  useAuthMini: () => auth,
}));

import { LinkitProvider, LinkitUserInfo, useLinkit } from "../src/index.js";
import {
  readCachedNotes,
  readCachedProfiles,
  writeCachedNotes,
  writeCachedProfiles,
} from "../src/user-info-cache.js";

const alice = {
  user_id: "550e8400-e29b-41d4-a716-446655440000",
  username: "alice",
  intro: "Research first",
  avatar_url: "https://images.example.test/alice.webp",
};
const aliceNote = {
  user_id: alice.user_id,
  name: "Fund investor",
  updated_at: 1,
};

let baseUrlIndex = 0;

function nextBaseUrl() {
  baseUrlIndex += 1;
  return `https://cache-${baseUrlIndex}.example.test`;
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function eventStreamResponse() {
  return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function providerRequest(url: string) {
  if (url.endsWith("/api/unread-count")) return Promise.resolve(json({ total: 0 }));
  if (url.endsWith("/api/events")) return Promise.resolve(eventStreamResponse());
  return undefined;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type FetchMock = MockInstance<(input: URL | RequestInfo, init?: RequestInit) => Promise<Response>>;

function fetchCalls(fetchMock: FetchMock, suffix: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(suffix)).length;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  auth.isAuthenticated = true;
  accessToken = tokenForSubject(viewerUserId);
});

describe("LinkitUserInfo persistent cache", () => {
  it("renders the cached profile immediately and revalidates it in the background", async () => {
    const baseUrl = nextBaseUrl();
    await writeCachedProfiles(
      baseUrl,
      new Map([[alice.user_id, { ...alice, username: "alice-old" }]]),
    );
    const profileBatch = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const provider = providerRequest(url);
      if (provider) return provider;
      if (url.endsWith("/api/public/profiles/batch")) return profileBatch.promise;
      if (url.endsWith("/api/user-notes/batch")) return Promise.resolve(json([]));
      throw new Error(`Unexpected Linkit request: ${url}`);
    });

    const rendered = render(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
      </LinkitProvider>,
    );

    const trigger = await screen.findByRole("button", { name: /user information: alice-old/i });
    expect(trigger).toHaveTextContent("alice-old");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/api/public/profiles/batch`,
        expect.objectContaining({
          body: JSON.stringify({ user_ids: [alice.user_id] }),
        }),
      ),
    );

    profileBatch.resolve(json([alice]));
    await screen.findByRole("button", { name: /user information: alice, /i });
    await vi.waitFor(async () => {
      const cached = await readCachedProfiles(baseUrl);
      expect(cached.get(alice.user_id)?.username).toBe("alice");
    });

    rendered.rerender(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
      </LinkitProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetchCalls(fetchMock, "/api/public/profiles/batch")).toBe(1);
  });

  it("persists revalidated profiles and remembered missing profiles", async () => {
    const baseUrl = nextBaseUrl();
    const bobId = "660e8400-e29b-41d4-a716-446655440000";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const provider = providerRequest(url);
      if (provider) return provider;
      if (url.endsWith("/api/public/profiles/batch")) return Promise.resolve(json([alice]));
      if (url.endsWith("/api/user-notes/batch")) return Promise.resolve(json([]));
      throw new Error(`Unexpected Linkit request: ${url}`);
    });

    render(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
        <LinkitUserInfo userId={bobId} />
      </LinkitProvider>,
    );

    await screen.findByRole("button", { name: /user information: alice, /i });
    await vi.waitFor(async () => {
      const cached = await readCachedProfiles(baseUrl);
      expect(cached.get(alice.user_id)?.username).toBe("alice");
      expect(cached.has(bobId)).toBe(true);
      expect(cached.get(bobId)).toBeNull();
    });
  });

  it("keeps the cached profile when revalidation fails", async () => {
    const baseUrl = nextBaseUrl();
    await writeCachedProfiles(baseUrl, new Map([[alice.user_id, alice]]));
    const profileBatch = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const provider = providerRequest(url);
      if (provider) return provider;
      if (url.endsWith("/api/public/profiles/batch")) return profileBatch.promise;
      if (url.endsWith("/api/user-notes/batch")) return Promise.resolve(json([]));
      throw new Error(`Unexpected Linkit request: ${url}`);
    });

    render(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
      </LinkitProvider>,
    );

    await screen.findByRole("button", { name: /user information: alice, /i });
    await waitFor(() => expect(fetchCalls(fetchMock, "/api/public/profiles/batch")).toBe(1));
    profileBatch.resolve(
      new Response(JSON.stringify({ error: { message: "boom" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(screen.getByRole("button", { name: /user information: alice, /i })).toBeInTheDocument();
    expect(screen.queryByText("This user's Linkit profile is unavailable.")).toBeNull();
    expect(fetchCalls(fetchMock, "/api/public/profiles/batch")).toBe(1);
  });

  it("rehydrates the viewer's private notes and revalidates them", async () => {
    const baseUrl = nextBaseUrl();
    await writeCachedNotes(baseUrl, viewerUserId, new Map([[alice.user_id, aliceNote]]));
    const noteBatch = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const provider = providerRequest(url);
      if (provider) return provider;
      if (url.endsWith("/api/public/profiles/batch")) return Promise.resolve(json([alice]));
      if (url.endsWith("/api/user-notes/batch")) return noteBatch.promise;
      throw new Error(`Unexpected Linkit request: ${url}`);
    });

    render(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
      </LinkitProvider>,
    );

    await screen.findByRole("button", { name: /user information: Fund investor/i });
    noteBatch.resolve(json([{ ...aliceNote, name: "Fund investor 2" }]));
    await screen.findByRole("button", { name: /user information: Fund investor 2/i });
    await vi.waitFor(async () => {
      const cached = await readCachedNotes(baseUrl, viewerUserId);
      expect(cached.get(alice.user_id)?.name).toBe("Fund investor 2");
    });
  });

  it("does not merge another viewer's persisted notes", async () => {
    const baseUrl = nextBaseUrl();
    await writeCachedNotes(
      baseUrl,
      otherViewerUserId,
      new Map([[alice.user_id, aliceNote]]),
    );
    const noteBatch = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const provider = providerRequest(url);
      if (provider) return provider;
      if (url.endsWith("/api/public/profiles/batch")) return Promise.resolve(json([alice]));
      if (url.endsWith("/api/user-notes/batch")) return noteBatch.promise;
      throw new Error(`Unexpected Linkit request: ${url}`);
    });

    render(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
      </LinkitProvider>,
    );

    await screen.findByRole("button", { name: /user information: alice, /i });
    expect(screen.queryByText("Fund investor")).toBeNull();
    noteBatch.resolve(json([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("button", { name: /user information: alice, /i })).toBeInTheDocument();
    expect(screen.queryByText("Fund investor")).toBeNull();
  });

  it("drops persisted notes on sign-out and keeps public profiles", async () => {
    const baseUrl = nextBaseUrl();
    await writeCachedNotes(baseUrl, viewerUserId, new Map([[alice.user_id, aliceNote]]));
    await writeCachedProfiles(baseUrl, new Map([[alice.user_id, alice]]));
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const provider = providerRequest(url);
      if (provider) return provider;
      if (url.endsWith("/api/public/profiles/batch")) return Promise.resolve(json([alice]));
      if (url.endsWith("/api/user-notes/batch")) return Promise.resolve(json([aliceNote]));
      throw new Error(`Unexpected Linkit request: ${url}`);
    });

    function SignOutProbe() {
      const { signOut } = useLinkit();
      return (
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      );
    }

    render(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
        <SignOutProbe />
      </LinkitProvider>,
    );

    await screen.findByRole("button", { name: /user information: Fund investor/i });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(async () => {
      const cachedNotes = await readCachedNotes(baseUrl, viewerUserId);
      expect(cachedNotes.size).toBe(0);
    });
    const cachedProfiles = await readCachedProfiles(baseUrl);
    expect(cachedProfiles.get(alice.user_id)?.username).toBe("alice");
  });

  it("persists note saves and deletions for the viewer", async () => {
    const baseUrl = nextBaseUrl();
    const savedNote = { ...aliceNote, name: "New note", updated_at: 2 };
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const provider = providerRequest(url);
      if (provider) return provider;
      if (url.endsWith("/api/public/profiles/batch")) return Promise.resolve(json([alice]));
      if (url.endsWith("/api/user-notes/batch")) return Promise.resolve(json([aliceNote]));
      if (url.endsWith(`/api/user-notes/${alice.user_id}`) && init?.method === "PUT")
        return Promise.resolve(json(savedNote));
      if (url.endsWith(`/api/user-notes/${alice.user_id}`) && init?.method === "DELETE")
        return Promise.resolve(new Response(null, { status: 204 }));
      throw new Error(`Unexpected Linkit request: ${url}`);
    });

    render(
      <LinkitProvider linkitBaseUrl={baseUrl}>
        <LinkitUserInfo userId={alice.user_id} />
      </LinkitProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /user information: Fund investor/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit private note" }));
    const noteInput = screen.getByLabelText("Private note");
    fireEvent.change(noteInput, { target: { value: "New note" } });
    fireEvent.submit(noteInput.closest("form")!);
    await screen.findByRole("button", { name: /user information: New note/i });
    await vi.waitFor(async () => {
      const cached = await readCachedNotes(baseUrl, viewerUserId);
      expect(cached.get(alice.user_id)?.name).toBe("New note");
    });

    fireEvent.click(await screen.findByRole("button", { name: "Edit private note" }));
    const emptyInput = screen.getByLabelText("Private note");
    fireEvent.change(emptyInput, { target: { value: "" } });
    fireEvent.blur(emptyInput);
    await vi.waitFor(async () => {
      const cached = await readCachedNotes(baseUrl, viewerUserId);
      expect(cached.has(alice.user_id)).toBe(true);
      expect(cached.get(alice.user_id)).toBeNull();
    });
  });
});
