import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useAuthMini } from "auth-mini-react-components";
import type { LinkitAttachment, LinkitMe, LinkitProfile, LinkitProfileUpdate, LinkitUserSearchResult } from "./types.js";

export type LinkitProviderProps = {
  linkitBaseUrl: string;
  children: ReactNode;
};

export type LinkitContextValue = {
  linkitBaseUrl: string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  getMe: () => Promise<LinkitMe>;
  getProfile: (userId: string) => Promise<LinkitProfile>;
  updateProfile: (profile: LinkitProfileUpdate) => Promise<LinkitProfile>;
  upload: (file: File) => Promise<LinkitAttachment>;
  searchUsers: (query: string, signal?: AbortSignal) => Promise<LinkitUserSearchResult[]>;
};

const LinkitContext = createContext<LinkitContextValue | undefined>(undefined);

export function LinkitProvider({ linkitBaseUrl, children }: LinkitProviderProps) {
  let auth: ReturnType<typeof useAuthMini>;
  try {
    auth = useAuthMini();
  } catch {
    throw new Error("LinkitProvider must be rendered inside AuthMiniProvider.");
  }
  const baseUrl = normalizeBaseUrl(linkitBaseUrl);
  const request = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const target = resolvePath(baseUrl, path);
    const send = async (forceRefresh: boolean) => {
      const session = auth.sdk?.session.getState();
      const token = forceRefresh ? (await auth.sdk?.session.refresh())?.accessToken : session?.accessToken;
      if (!token) throw new Error("Linkit requires an authenticated Auth Mini session.");
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return fetch(target, { ...init, headers });
    };
    let response = await send(false);
    if (response.status === 401) response = await send(true);
    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
      throw new Error(body?.error?.message ?? `Linkit request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }, [auth.sdk, baseUrl]);
  const value = useMemo<LinkitContextValue>(() => ({
    linkitBaseUrl: baseUrl,
    request,
    getMe: () => request<LinkitMe>("/api/me"),
    getProfile: (userId) => request<LinkitProfile>(`/api/public/profiles/${encodeURIComponent(userId)}`),
    updateProfile: (profile) => request<LinkitProfile>("/api/profile", { method: "PUT", body: JSON.stringify(profile) }),
    searchUsers: (query, signal) => request<LinkitUserSearchResult[]>(`/api/users/search?query=${encodeURIComponent(query)}`, { signal }),
    upload: (file) => {
      const form = new FormData();
      form.append("file", file);
      return request<LinkitAttachment>("/api/attachments", { method: "POST", body: form });
    },
  }), [baseUrl, request]);
  return <LinkitContext.Provider value={value}>{children}</LinkitContext.Provider>;
}

export function useLinkit() {
  const value = useContext(LinkitContext);
  if (!value) throw new Error("useLinkit must be used within LinkitProvider.");
  return value;
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("linkitBaseUrl must use HTTP(S).");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function resolvePath(baseUrl: string, path: string) {
  if (!path.startsWith("/")) throw new Error("Linkit request paths must begin with '/'.");
  return new URL(path, `${baseUrl}/`).toString();
}
