import type { AuthMiniApi } from "auth-mini/sdk/browser";

export type Profile = {
  user_id: string;
  username: string;
  display_name: string;
  motto: string;
  avatar_attachment_id?: string;
  updated_at: number;
};

export type Attachment = {
  id: string;
  file_name: string;
  media_type: string;
  byte_size: number;
  created_at: number;
};

export type Conversation = {
  id: string;
  kind: "direct" | "group";
  title: string;
  avatar_attachment_id?: string;
  counterpart_name?: string;
  counterpart_avatar_attachment_id?: string;
  created_by: string;
  created_at: number;
  latest_body?: string;
  latest_at?: number;
  unread_count: number;
};

export type ConversationDetail = Conversation & {
  members: Array<{
    user_id: string;
    username: string;
    display_name: string;
    role: string;
  }>;
  bots: Bot[];
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_kind: "user" | "bot";
  sender_id: string;
  sender_name: string;
  sender_deleted: boolean;
  body: string;
  urgent: boolean;
  created_at: number;
  attachments: Attachment[];
  cursor: string;
};

export type MessagePage = {
  messages: Message[];
  older_cursor?: string;
  newer_cursor?: string;
};

export type Bot = {
  id: string;
  owner_user_id: string;
  name: string;
  token_prefix: string;
  created_at: number;
  updated_at: number;
};

export type Config = {
  setup_required: boolean;
  auth_issuer?: string;
  public_origin?: string;
};

export type Me = {
  id: string;
  root: boolean;
  profile?: Profile;
};

export type SystemOverview = {
  generated_at: number;
  cpu_usage_percent: number;
  used_memory_bytes: number;
  total_memory_bytes: number;
  received_bytes_per_second: number;
  transmitted_bytes_per_second: number;
  received_bytes_total: number;
  transmitted_bytes_total: number;
  sqlite_bytes: number;
  disks: Array<{
    mount_point: string;
    total_bytes: number;
    available_bytes: number;
  }>;
};

export type BarkNotificationUser = {
  display_name: string;
  username: string;
  device_count: number;
  last_device_updated_at: number;
};

export type BarkNotificationSettings = {
  base_url: string;
  devices: Array<{
    id: string;
    created_at: number;
    updated_at: number;
  }>;
  apns_configured: boolean;
};

export function openPagePath(search = window.location.search) {
  const params = new URLSearchParams(search);
  const open = params.get("open");
  const username = params.get("username");
  if (open === "profile") return "#/settings/profile";
  if (open === "message" && username)
    return `#/compose/${encodeURIComponent(username)}`;
  return "#/conversations";
}

export async function publicApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, init);
  return readResponse<T>(response);
}

export async function api<T>(
  sdk: AuthMiniApi,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await authenticatedFetch(sdk, path, requestInit(init));
  return readResponse<T>(response);
}

export function subscribeToEvents(
  sdk: AuthMiniApi,
  onEvent: (event: {
    conversation_id: string;
    sender_id: string;
    message: Message;
  }) => void,
) {
  const controller = new AbortController();
  void authenticatedFetch(sdk, "/api/events", { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok || !response.body)
        throw new Error("Event stream is unavailable");
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
          if (data)
            onEvent(
              JSON.parse(data) as {
                conversation_id: string;
                sender_id: string;
                message: Message;
              },
            );
        }
      }
    })
    .catch(() => undefined);
  return () => controller.abort();
}

export async function upload(sdk: AuthMiniApi, file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<Attachment>(sdk, "/api/attachments", {
    method: "POST",
    body: form,
  });
}

export async function attachmentObjectUrl(sdk: AuthMiniApi, id: string) {
  const response = await authenticatedFetch(
    sdk,
    `/api/attachments/${id}/content`,
  );
  if (!response.ok) throw new Error("Could not download attachment");
  return URL.createObjectURL(await response.blob());
}

export async function avatarObjectUrl(sdk: AuthMiniApi, id: string) {
  const response = await authenticatedFetch(sdk, `/api/attachments/${id}/avatar`);
  if (!response.ok) throw new Error("Could not download avatar");
  return URL.createObjectURL(await response.blob());
}

async function authenticatedFetch(
  sdk: AuthMiniApi,
  path: string,
  init: RequestInit = {},
) {
  const request = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  };
  const accessToken = await validAccessToken(sdk);
  const response = await request(accessToken);
  if (response.status !== 401) return response;
  const currentToken = await validAccessToken(sdk);
  return request(
    currentToken === accessToken ? await refreshAccessToken(sdk) : currentToken,
  );
}

function requestInit(init: RequestInit) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  return { ...init, headers };
}

async function validAccessToken(sdk: AuthMiniApi) {
  const session = sdk.session.getState();
  if (!session.accessToken)
    throw new Error("The Auth Mini session is no longer authenticated.");
  const expiresAt = Date.parse(session.expiresAt ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000)
    return refreshAccessToken(sdk);
  return session.accessToken;
}

async function refreshAccessToken(sdk: AuthMiniApi) {
  const session = await sdk.session.refresh();
  if (!session.accessToken)
    throw new Error("Auth Mini did not return an access token.");
  return session.accessToken;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      { error?: { message?: string } } | undefined;
    throw new Error(
      payload?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}
