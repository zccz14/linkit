import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  lang?: string;
  children: ReactNode;
};

type LinkitUserInfoCopy = {
  unknownUser: string;
  userInformation: string;
  profileUnavailable: string;
  directMessage: string;
  openingDirectMessage: string;
  cannotMessageYourself: string;
  signInToMessage: string;
  popupBlocked: string;
};

type LinkitUserInfoContextValue = {
  copy: LinkitUserInfoCopy;
  openDirectConversation: (userId: string, username: string) => Promise<void>;
  profiles: ReadonlyMap<string, LinkitProfile | null>;
  requestProfiles: (userIds: readonly string[]) => void;
};

const profileBatchDelayMs = 40;
const profileBatchSize = 100;

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
const LinkitUserInfoContext = createContext<LinkitUserInfoContextValue | undefined>(undefined);

export function LinkitProvider({
  linkitBaseUrl,
  lang = "en",
  children,
}: LinkitProviderProps) {
  let auth: ReturnType<typeof useAuthMini>;
  try {
    auth = useAuthMini();
  } catch {
    throw new Error("LinkitProvider must be rendered inside AuthMiniProvider.");
  }
  const baseUrl = normalizeBaseUrl(linkitBaseUrl);
  const [profiles, setProfiles] = useState<Map<string, LinkitProfile | null>>(
    () => new Map(),
  );
  const profilesRef = useRef(profiles);
  const pendingProfileIds = useRef(new Set<string>());
  const requestedProfileIds = useRef(new Set<string>());
  const profileBatchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const storeProfiles = useCallback(
    (updates: ReadonlyMap<string, LinkitProfile | null>) => {
      const next = new Map(profilesRef.current);
      for (const [userId, profile] of updates) next.set(userId, profile);
      profilesRef.current = next;
      setProfiles(next);
    },
    [],
  );
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
  const getProfile = useCallback(
    async (userId: string) => {
      const profile = await publicRequest<LinkitProfile>(
        baseUrl,
        `/api/public/profiles/${encodeURIComponent(userId)}`,
      );
      storeProfiles(new Map([[userId, profile]]));
      return profile;
    },
    [baseUrl, storeProfiles],
  );
  const flushProfileBatch = useCallback(async () => {
    profileBatchTimer.current = undefined;
    const userIds = [...pendingProfileIds.current];
    pendingProfileIds.current.clear();
    if (!userIds.length) return;
    try {
      const profiles = (
        await Promise.all(
          Array.from(
            { length: Math.ceil(userIds.length / profileBatchSize) },
            (_, index) =>
              publicRequest<LinkitProfile[]>(
                baseUrl,
                "/api/public/profiles/batch",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    user_ids: userIds.slice(
                      index * profileBatchSize,
                      (index + 1) * profileBatchSize,
                    ),
                  }),
                },
              ),
          ),
        )
      ).flat();
      const byUserId = new Map(profiles.map((profile) => [profile.user_id, profile]));
      storeProfiles(
        new Map(userIds.map((userId) => [userId, byUserId.get(userId) ?? null])),
      );
    } catch {
      storeProfiles(new Map(userIds.map((userId) => [userId, null])));
    } finally {
      for (const userId of userIds) requestedProfileIds.current.delete(userId);
    }
  }, [baseUrl, storeProfiles]);
  const requestProfiles = useCallback(
    (userIds: readonly string[]) => {
      for (const userId of new Set(userIds)) {
        if (!userId || profilesRef.current.has(userId) || requestedProfileIds.current.has(userId)) continue;
        requestedProfileIds.current.add(userId);
        pendingProfileIds.current.add(userId);
      }
      if (!pendingProfileIds.current.size || profileBatchTimer.current) return;
      profileBatchTimer.current = setTimeout(() => {
        void flushProfileBatch();
      }, profileBatchDelayMs);
    },
    [flushProfileBatch],
  );
  useEffect(
    () => () => {
      if (profileBatchTimer.current) clearTimeout(profileBatchTimer.current);
    },
    [],
  );
  const userInfoCopy = useMemo(() => userInfoLabels(lang), [lang]);
  const openUserDirectConversation = useCallback(
    async (userId: string, username: string) => {
      if (!auth.isAuthenticated) throw new Error(userInfoCopy.signInToMessage);
      const conversationWindow = window.open("", "_blank");
      if (!conversationWindow) throw new Error(userInfoCopy.popupBlocked);
      conversationWindow.opener = null;
      try {
        const me = await request<LinkitMe>("/api/me");
        if (me.id === userId) throw new Error(userInfoCopy.cannotMessageYourself);
        const conversation = await request<LinkitConversation>(
          `/api/conversations/direct/${encodeURIComponent(username)}`,
          { method: "POST" },
        );
        conversationWindow.location.replace(conversationUrl(baseUrl, conversation.id));
      } catch (cause) {
        conversationWindow.close();
        throw cause;
      }
    },
    [auth.isAuthenticated, baseUrl, request, userInfoCopy],
  );
  const value = useMemo<LinkitContextValue>(
    () => ({
      linkitBaseUrl: baseUrl,
      request,
      getMe: () => request<LinkitMe>("/api/me"),
      getProfile,
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
    [baseUrl, getProfile, request, requestRaw],
  );
  const userInfoValue = useMemo<LinkitUserInfoContextValue>(
    () => ({
      copy: userInfoCopy,
      openDirectConversation: openUserDirectConversation,
      profiles,
      requestProfiles,
    }),
    [openUserDirectConversation, profiles, requestProfiles, userInfoCopy],
  );
  return (
    <LinkitContext.Provider value={value}>
      <LinkitUserInfoContext.Provider value={userInfoValue}>
        {children}
      </LinkitUserInfoContext.Provider>
    </LinkitContext.Provider>
  );
}

export function useLinkit() {
  const value = useContext(LinkitContext);
  if (!value) throw new Error("useLinkit must be used within LinkitProvider.");
  return value;
}

export function useLinkitUserInfo(userId: string) {
  const value = useContext(LinkitUserInfoContext);
  if (!value) throw new Error("LinkitUserInfo must be used within LinkitProvider.");
  useEffect(() => {
    value.requestProfiles([userId]);
  }, [userId, value]);
  return {
    copy: value.copy,
    openDirectConversation: value.openDirectConversation,
    profile: value.profiles.get(userId) ?? null,
    loading: !value.profiles.has(userId),
  };
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

async function publicRequest<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const target = resolvePath(baseUrl, path);
  const response = init ? await fetch(target, init) : await fetch(target);
  if (!response.ok)
    throw await requestError(response, "Linkit public request failed");
  return (await response.json()) as T;
}

function userInfoLabels(value: string): LinkitUserInfoCopy {
  if (value.toLowerCase() === "zh" || value.toLowerCase().startsWith("zh-")) {
    return {
      unknownUser: "未知用户",
      userInformation: "用户资料",
      profileUnavailable: "该用户的 Linkit 资料不可用。",
      directMessage: "私信",
      openingDirectMessage: "正在打开私信…",
      cannotMessageYourself: "不能向自己发送私信。",
      signInToMessage: "登录后才能发送私信。",
      popupBlocked: "浏览器阻止了 Linkit 私聊窗口。",
    };
  }
  return {
    unknownUser: "Unknown user",
    userInformation: "User information",
    profileUnavailable: "This user's Linkit profile is unavailable.",
    directMessage: "Message",
    openingDirectMessage: "Opening direct message…",
    cannotMessageYourself: "You can't send a direct message to yourself.",
    signInToMessage: "Sign in to send a direct message.",
    popupBlocked: "Your browser blocked the Linkit conversation window.",
  };
}

function conversationUrl(linkitBaseUrl: string, conversationId: string) {
  const url = new URL(linkitBaseUrl);
  url.hash = `/conversations/${encodeURIComponent(conversationId)}`;
  return url.toString();
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
