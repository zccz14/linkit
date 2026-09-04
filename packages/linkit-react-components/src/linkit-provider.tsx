import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useAuthMini } from "auth-mini-react-components";
import type {
  LinkitAttachment,
  LinkitConversation,
  LinkitMe,
  LinkitMessage,
  LinkitMessagePage,
  LinkitProfile,
  LinkitProfileUpdate,
  LinkitUserSearchResult,
} from "./types.js";

export type LinkitProviderProps = {
  linkitBaseUrl: string;
  children: ReactNode;
};

type LinkitMessageEvent = {
  conversation_id: string;
  sender_id: string;
  message: LinkitMessage;
};

export type LinkitContextValue = {
  linkitBaseUrl: string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  getMe: () => Promise<LinkitMe>;
  getProfile: (userId: string) => Promise<LinkitProfile>;
  updateProfile: (profile: LinkitProfileUpdate) => Promise<LinkitProfile>;
  upload: (file: File) => Promise<LinkitAttachment>;
  downloadAttachment: (attachmentId: string) => Promise<Blob>;
  searchUsers: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<LinkitUserSearchResult[]>;
  openDirectConversation: (username: string) => Promise<LinkitConversation>;
  getConversation: (conversationId: string) => Promise<LinkitConversation>;
  listMessages: (
    conversationId: string,
    cursor?: { beforeCursor?: string; afterCursor?: string },
  ) => Promise<LinkitMessagePage>;
  sendMessage: (
    conversationId: string,
    input: { body: string; attachmentIds?: string[]; urgent?: boolean },
  ) => Promise<LinkitMessage>;
  markConversationRead: (conversationId: string) => Promise<void>;
  subscribeToConversationMessages: (
    conversationId: string,
    onMessage: (message: LinkitMessage) => void,
  ) => () => void;
};

const LinkitContext = createContext<LinkitContextValue | undefined>(undefined);

export function LinkitProvider({
  linkitBaseUrl,
  children,
}: LinkitProviderProps) {
  let auth: ReturnType<typeof useAuthMini>;
  try {
    auth = useAuthMini();
  } catch {
    throw new Error("LinkitProvider must be rendered inside AuthMiniProvider.");
  }
  const baseUrl = normalizeBaseUrl(linkitBaseUrl);
  const requestRaw = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const target = resolvePath(baseUrl, path);
      const send = async (forceRefresh: boolean) => {
        const session = auth.sdk?.session.getState();
        const token = forceRefresh
          ? (await auth.sdk?.session.refresh())?.accessToken
          : session?.accessToken;
        if (!token)
          throw new Error(
            "Linkit requires an authenticated Auth Mini session.",
          );
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);
        if (
          init.body &&
          !(init.body instanceof FormData) &&
          !headers.has("Content-Type")
        )
          headers.set("Content-Type", "application/json");
        return fetch(target, { ...init, headers });
      };
      let response = await send(false);
      if (response.status === 401) response = await send(true);
      if (!response.ok) throw await requestError(response);
      return response;
    },
    [auth.sdk, baseUrl],
  );
  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const response = await requestRaw(path, init);
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
    [requestRaw],
  );
  const value = useMemo<LinkitContextValue>(
    () => ({
      linkitBaseUrl: baseUrl,
      request,
      getMe: () => request<LinkitMe>("/api/me"),
      getProfile: (userId) =>
        publicRequest<LinkitProfile>(
          baseUrl,
          `/api/public/profiles/${encodeURIComponent(userId)}`,
        ),
      updateProfile: (profile) =>
        request<LinkitProfile>("/api/profile", {
          method: "PUT",
          body: JSON.stringify(profile),
        }),
      searchUsers: (query, signal) =>
        request<LinkitUserSearchResult[]>(
          `/api/users/search?query=${encodeURIComponent(query)}`,
          { signal },
        ),
      openDirectConversation: (username) =>
        request<LinkitConversation>(
          `/api/conversations/direct/${encodeURIComponent(username)}`,
          { method: "POST" },
        ),
      getConversation: (conversationId) =>
        request<LinkitConversation>(
          `/api/conversations/${encodeURIComponent(conversationId)}`,
        ),
      listMessages: (conversationId, cursor = {}) => {
        const params = new URLSearchParams();
        if (cursor.beforeCursor)
          params.set("before_cursor", cursor.beforeCursor);
        if (cursor.afterCursor) params.set("after_cursor", cursor.afterCursor);
        const query = params.size ? `?${params.toString()}` : "";
        return request<LinkitMessagePage>(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
        );
      },
      sendMessage: (conversationId, input) =>
        request<LinkitMessage>(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
          {
            method: "POST",
            body: JSON.stringify({
              body: input.body,
              attachment_ids: input.attachmentIds ?? [],
              urgent: input.urgent ?? false,
            }),
          },
        ),
      markConversationRead: (conversationId) =>
        request<void>(
          `/api/conversations/${encodeURIComponent(conversationId)}/read`,
          { method: "POST" },
        ),
      upload: (file) => {
        const form = new FormData();
        form.append("file", file);
        return request<LinkitAttachment>("/api/attachments", {
          method: "POST",
          body: form,
        });
      },
      downloadAttachment: async (attachmentId) =>
        (
          await requestRaw(
            `/api/attachments/${encodeURIComponent(attachmentId)}/content`,
          )
        ).blob(),
      subscribeToConversationMessages: (conversationId, onMessage) =>
        subscribeToEvents(requestRaw, conversationId, onMessage),
    }),
    [baseUrl, request, requestRaw],
  );
  return (
    <LinkitContext.Provider value={value}>{children}</LinkitContext.Provider>
  );
}

export function useLinkit() {
  const value = useContext(LinkitContext);
  if (!value) throw new Error("useLinkit must be used within LinkitProvider.");
  return value;
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("linkitBaseUrl must use HTTP(S).");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function resolvePath(baseUrl: string, path: string) {
  if (!path.startsWith("/"))
    throw new Error("Linkit request paths must begin with '/'.");
  return new URL(path, `${baseUrl}/`).toString();
}

async function publicRequest<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(resolvePath(baseUrl, path));
  if (!response.ok)
    throw await requestError(response, "Linkit public request failed");
  return (await response.json()) as T;
}

async function requestError(
  response: Response,
  fallback = "Linkit request failed",
) {
  const body = (await response.json().catch(() => undefined)) as
    { error?: { message?: string } } | undefined;
  return new Error(body?.error?.message ?? `${fallback} (${response.status}).`);
}

function subscribeToEvents(
  requestRaw: (path: string, init?: RequestInit) => Promise<Response>,
  conversationId: string,
  onMessage: (message: LinkitMessage) => void,
) {
  const controller = new AbortController();
  void requestRaw("/api/events", { signal: controller.signal })
    .then(async (response) => {
      if (!response.body)
        throw new Error("Linkit event stream is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
          if (!data) continue;
          const payload = JSON.parse(data) as LinkitMessageEvent;
          if (payload.conversation_id === conversationId)
            onMessage(payload.message);
        }
      }
    })
    .catch(() => undefined);
  return () => controller.abort();
}
