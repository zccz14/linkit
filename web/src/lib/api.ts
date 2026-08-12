export type Profile = {
  user_id: string
  username: string
  display_name: string
  motto: string
  avatar_attachment_id?: string
  updated_at: number
}

export type Attachment = {
  id: string
  file_name: string
  media_type: string
  byte_size: number
  created_at: number
}

export type Conversation = {
  id: string
  kind: "direct" | "group"
  title: string
  created_by: string
  created_at: number
  latest_body?: string
  latest_at?: number
  unread_count: number
}

export type ConversationDetail = Conversation & {
  members: Array<{ user_id: string; username: string; display_name: string; role: string }>
  bots: Bot[]
}

export type Message = {
  id: string
  conversation_id: string
  sender_kind: "user" | "bot"
  sender_id: string
  sender_name: string
  body: string
  created_at: number
  attachments: Attachment[]
}

export type Bot = {
  id: string
  owner_user_id: string
  name: string
  token_prefix: string
  created_at: number
  updated_at: number
}

export type Config = {
  setup_required: boolean
  auth_issuer?: string
  public_origin?: string
}

export type Me = {
  id: string
  root: boolean
  profile?: Profile
}

const SESSION_KEY = "linkit.auth-mini.session"
const LOGIN_KEY = "linkit.auth-mini.login"

type StoredSession = {
  accessToken: string
  refreshToken: string
  sessionId: string
  expiresAt: string
}

export function session(): StoredSession | undefined {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as StoredSession
    return value.accessToken && value.refreshToken && value.sessionId
      ? value
      : undefined
  } catch {
    return undefined
  }
}

function sessionIssuer() {
  try {
    const context = JSON.parse(sessionStorage.getItem(LOGIN_KEY) ?? "{}") as { issuer?: string }
    return context.issuer
  } catch {
    return undefined
  }
}

async function refreshSession() {
  const current = session()
  const issuer = sessionIssuer()
  if (!current || !issuer) return undefined
  const response = await fetch(`${issuer}/session/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: current.sessionId, refresh_token: current.refreshToken }),
  })
  if (!response.ok) return undefined
  const next = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    session_id?: string
    expires_in?: number
  }
  if (!next.access_token || !next.refresh_token || !next.session_id || !next.expires_in)
    return undefined
  const renewed = {
    accessToken: next.access_token,
    refreshToken: next.refresh_token,
    sessionId: next.session_id,
    expiresAt: new Date(Date.now() + next.expires_in * 1000).toISOString(),
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(renewed))
  return renewed
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function startLogin(issuer: string) {
  const state = crypto.randomUUID()
  sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ issuer, state }))
  const callback = new URL(window.location.href)
  callback.hash = "#/auth/callback"
  const params = new URLSearchParams({ redirect_uri: callback.toString(), state })
  const login = new URL("web/", `${issuer.replace(/\/+$/, "")}/`)
  login.hash = `/login?${params.toString()}`
  window.location.assign(login.toString())
}

export function consumeLoginCallback() {
  const hash = window.location.hash
  if (!hash.includes("access_token=")) return ""
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : ""
  const params = new URLSearchParams(query)
  try {
    const context = JSON.parse(sessionStorage.getItem(LOGIN_KEY) ?? "{}") as {
      state?: string
      issuer?: string
    }
    if (!context.state || params.get("state") !== context.state)
      throw new Error("Auth Mini login state does not match")
    const accessToken = params.get("access_token")
    const refreshToken = params.get("refresh_token")
    const sessionId = params.get("session_id")
    const expiresIn = Number(params.get("expires_in"))
    if (
      !accessToken ||
      !refreshToken ||
      !sessionId ||
      params.get("token_type") !== "Bearer" ||
      !Number.isFinite(expiresIn)
    )
      throw new Error("Auth Mini login callback is incomplete")
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        accessToken,
        refreshToken,
        sessionId,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      })
    )
    sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ issuer: context.issuer }))
    window.history.replaceState(null, "", `${window.location.pathname}${openPagePath()}`)
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : "Auth Mini login failed"
  }
}

export function openPagePath() {
  const params = new URLSearchParams(window.location.search)
  const open = params.get("open")
  const username = params.get("username")
  if (open === "profile") return "#/settings/profile"
  if (open === "message" && username) return `#/compose/${encodeURIComponent(username)}`
  return "#/inbox"
}

export function subscribeToEvents(onEvent: (event: { conversation_id: string; sender_id: string }) => void) {
  const current = session()
  if (!current) return () => undefined
  const controller = new AbortController()
  void fetch("/api/events", { headers: { Authorization: `Bearer ${current.accessToken}` }, signal: controller.signal })
    .then(async (response) => {
      if (!response.ok || !response.body) throw new Error("Event stream is unavailable")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (!controller.signal.aborted) {
        const next = await reader.read()
        if (next.done) break
        buffer += decoder.decode(next.value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""
        for (const event of events) {
          const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
          if (data) onEvent(JSON.parse(data) as { conversation_id: string; sender_id: string })
        }
      }
    })
    .catch(() => undefined)
  return () => controller.abort()
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const current = session()
  if (current) headers.set("Authorization", `Bearer ${current.accessToken}`)
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json")
  let response = await fetch(path, { ...init, headers })
  if (response.status === 401) {
    const renewed = await refreshSession()
    if (renewed) {
      headers.set("Authorization", `Bearer ${renewed.accessToken}`)
      response = await fetch(path, { ...init, headers })
    }
  }
  if (response.status === 204) return undefined as T
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export async function upload(file: File) {
  const form = new FormData()
  form.append("file", file)
  return api<Attachment>("/api/attachments", { method: "POST", body: form })
}

export async function attachmentObjectUrl(id: string) {
  const current = session()
  if (!current) throw new Error("Sign in to access attachments")
  let response = await fetch(`/api/attachments/${id}/content`, { headers: { Authorization: `Bearer ${current.accessToken}` } })
  if (response.status === 401) {
    const renewed = await refreshSession()
    if (renewed)
      response = await fetch(`/api/attachments/${id}/content`, { headers: { Authorization: `Bearer ${renewed.accessToken}` } })
  }
  if (!response.ok) throw new Error("Could not download attachment")
  return URL.createObjectURL(await response.blob())
}
