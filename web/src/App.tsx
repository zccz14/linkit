import { useEffect, useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom"
import {
  BellIcon,
  BotIcon,
  FileIcon,
  ImageIcon,
  LogInIcon,
  LogOutIcon,
  MessageCircleIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Toaster } from "@/components/ui/sonner"
import { api, attachmentObjectUrl, clearSession, consumeLoginCallback, openPagePath, session, startLogin, subscribeToEvents, upload, type Attachment, type Bot, type Config, type Conversation, type ConversationDetail, type Me, type Message, type Profile } from "@/lib/api"

const profileRoute = (username: string) => `/people/${encodeURIComponent(username)}`
export default function App() {
  const callbackError = consumeLoginCallback()
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<Config>("/api/config") })

  useEffect(() => {
    if (callbackError) toast.error(callbackError)
  }, [callbackError])

  useEffect(() => {
    if (!window.location.search) return
    window.history.replaceState(null, "", `${window.location.pathname}${openPagePath()}`)
    window.dispatchEvent(new HashChangeEvent("hashchange"))
  }, [])

  if (config.isPending) return <main className="grid min-h-screen place-items-center">Loading Linkit…</main>
  if (config.isError) return <main className="grid min-h-screen place-items-center">{config.error.message}</main>
  if (config.data.setup_required) return <Setup />
  return <AuthedApp config={config.data} />
}

function Setup() {
  const [rootUserId, setRootUserId] = useState("")
  const [issuer, setIssuer] = useState("https://auth.ntnl.io")
  const [audience, setAudience] = useState(window.location.hostname)
  const [origin, setOrigin] = useState(window.location.origin)
  const mutation = useMutation({
    mutationFn: () =>
      api("/api/setup", {
        method: "POST",
        body: JSON.stringify({ root_user_id: rootUserId, auth_issuer: issuer, auth_audience: audience, public_origin: origin }),
      }),
    onSuccess: () => window.location.reload(),
    onError: (error) => toast.error(error.message),
  })
  const signIn = () => startLogin(issuer)

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Initialize Linkit</CardTitle>
          <CardDescription>Connect this Linkit instance to its Auth Mini identity boundary.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="root-user-id">Root user ID</FieldLabel>
                <Input id="root-user-id" required value={rootUserId} onChange={(event) => setRootUserId(event.target.value)} />
                <FieldDescription>Must equal the subject in the Auth Mini token used to submit setup.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="auth-issuer">Auth Mini issuer</FieldLabel>
                <Input id="auth-issuer" required type="url" value={issuer} onChange={(event) => setIssuer(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="audience">Auth Mini audience</FieldLabel>
                <Input id="audience" required value={audience} onChange={(event) => setAudience(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="public-origin">Public origin</FieldLabel>
                <Input id="public-origin" required type="url" value={origin} onChange={(event) => setOrigin(event.target.value)} />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={signIn}><LogInIcon data-icon="inline-start" />Sign in with Auth Mini</Button>
              <Button disabled={mutation.isPending}>{mutation.isPending ? "Initializing…" : "Initialize Linkit"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Toaster richColors />
    </main>
  )
}

function AuthedApp({ config }: { config: Config }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), enabled: Boolean(session()) })
  if (!session()) return <SignIn config={config} />
  if (me.isPending) return <main className="grid min-h-screen place-items-center">Restoring your Linkit session…</main>
  if (me.isError) {
    clearSession()
    return <SignIn config={config} error={me.error.message} />
  }
  if (!me.data.profile) return <ProfileEditor me={me.data} />
  return <Shell me={me.data} />
}

function SignIn({ config, error }: { config: Config; error?: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-10">
      <Card className="w-full">
        <CardHeader><CardTitle>Welcome to Linkit</CardTitle><CardDescription>Your profile, your conversations, your bots.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={() => startLogin(config.auth_issuer!)}><LogInIcon data-icon="inline-start" />Continue with Auth Mini</Button>
        </CardContent>
      </Card>
      <Toaster richColors />
    </main>
  )
}

function Shell({ me }: { me: Me }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: () => api<Conversation[]>("/api/conversations"), refetchInterval: 4_000 })
  const [notificationPermission, setNotificationPermission] = useState(Notification.permission)
  useEffect(() => {
    return subscribeToEvents((event) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] })
      void queryClient.invalidateQueries({ queryKey: ["messages", event.conversation_id] })
      if (event.sender_id !== me.id && notificationPermission === "granted" && document.visibilityState !== "visible")
        new Notification("New Linkit message", { body: "Open Linkit to read it." })
    })
  }, [me.id, notificationPermission, queryClient])
  const enableNotifications = async () => {
    setNotificationPermission(await Notification.requestPermission())
  }
  const links = [
    ["/inbox", "Inbox", MessageCircleIcon],
    ["/directory", "Directory", UsersRoundIcon],
    ["/bots", "Bots", BotIcon],
    ["/settings/profile", "Profile", SettingsIcon],
  ] as const
  return (
    <div className="grid min-h-screen grid-cols-[17rem_1fr] bg-muted/30 max-md:grid-cols-1">
      <aside className="flex min-h-screen flex-col gap-4 border-r bg-background p-4 max-md:min-h-0">
        <Link className="flex items-center gap-2 px-2 text-lg font-semibold" to="/inbox"><MessageCircleIcon />Linkit</Link>
        <nav className="flex flex-col gap-1">
          {links.map(([to, label, Icon]) => <Button key={to} variant={location.pathname === to ? "secondary" : "ghost"} className="justify-start" onClick={() => navigate(to)}><Icon data-icon="inline-start" />{label}</Button>)}
        </nav>
        <Separator />
        <div className="flex items-center justify-between px-2 text-sm text-muted-foreground"><span>Conversations</span><Button variant="ghost" size="icon-sm" aria-label="New group" onClick={() => navigate("/groups/new")}><PlusIcon /></Button></div>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {conversations.data?.map((conversation) => <Button key={conversation.id} variant={location.pathname === `/inbox/${conversation.id}` ? "secondary" : "ghost"} className="justify-between" onClick={() => navigate(`/inbox/${conversation.id}`)}><span className="truncate">{conversation.title || "Direct message"}</span>{conversation.unread_count ? <Badge>{conversation.unread_count}</Badge> : null}</Button>)}
        </div>
        <div className="mt-auto flex items-center gap-2 border-t pt-4">
          <ProfileAvatar profile={me.profile} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{me.profile!.display_name}</p><p className="truncate text-xs text-muted-foreground">@{me.profile!.username}</p></div>
          {notificationPermission === "default" ? <Button variant="ghost" size="icon-sm" aria-label="Enable notifications" onClick={enableNotifications}><BellIcon /></Button> : null}
          <Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={() => { clearSession(); window.location.assign("/") }}><LogOutIcon /></Button>
        </div>
      </aside>
      <main className="min-w-0">
        <Routes>
          <Route path="/inbox" element={<InboxEmpty />} />
          <Route path="/inbox/:id" element={<ConversationPage me={me} />} />
          <Route path="/directory" element={<Directory />} />
          <Route path="/people/:username" element={<Person />} />
          <Route path="/compose/:username" element={<Compose />} />
          <Route path="/groups/new" element={<GroupCreator />} />
          <Route path="/bots" element={<Bots />} />
          <Route path="/settings/profile" element={<ProfileEditor me={me} />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </main>
      <Toaster richColors />
    </div>
  )
}

function InboxEmpty() {
  return <div className="grid min-h-screen place-items-center p-6"><Empty><EmptyHeader><EmptyMedia variant="icon"><MessageCircleIcon /></EmptyMedia><EmptyTitle>Choose a conversation</EmptyTitle><EmptyDescription>Find someone in the directory, start a direct message, or create a group.</EmptyDescription></EmptyHeader></Empty></div>
}

function ConversationPage({ me }: { me: Me }) {
  const { id = "" } = useParams()
  const queryClient = useQueryClient()
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [manageOpen, setManageOpen] = useState(false)
  const [botId, setBotId] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const messages = useQuery({ queryKey: ["messages", id], queryFn: () => api<Message[]>(`/api/conversations/${id}/messages`), refetchInterval: 3_000 })
  const detail = useQuery({ queryKey: ["conversation", id], queryFn: () => api<ConversationDetail>(`/api/conversations/${id}`) })
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => api<Bot[]>("/api/bots"), enabled: manageOpen })
  const addBot = useMutation({ mutationFn: () => api(`/api/bots/${botId}/groups/${id}`, { method: "POST" }), onSuccess: () => { setBotId(""); setManageOpen(false); void detail.refetch(); toast.success("Bot added to group") }, onError: (error) => toast.error(error.message) })
  const send = useMutation({
    mutationFn: () => api<Message>(`/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ body, attachment_ids: attachments.map((attachment) => attachment.id) }) }),
    onSuccess: () => { setBody(""); setAttachments([]); void queryClient.invalidateQueries({ queryKey: ["messages", id] }); void queryClient.invalidateQueries({ queryKey: ["conversations"] }) },
    onError: (error) => toast.error(error.message),
  })
  useEffect(() => { void api(`/api/conversations/${id}/read`, { method: "POST" }).catch(() => undefined) }, [id])
  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const attachment = await upload(file)
      setAttachments((current) => [...current, attachment])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed")
    }
    event.target.value = ""
  }
  const submit = (event: FormEvent) => { event.preventDefault(); send.mutate() }
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-2 border-b bg-background px-6 py-4"><MessageCircleIcon /><h1 className="flex-1 font-semibold">{detail.data?.title || "Direct message"}</h1>{detail.data?.kind === "group" ? <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}><UsersRoundIcon data-icon="inline-start" />Members</Button> : null}</header>
      <section className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        {messages.data?.map((message) => <MessageRow key={message.id} message={message} mine={message.sender_kind === "user" && message.sender_id === me.id} />)}
      </section>
      <form className="border-t bg-background p-4" onSubmit={submit}>
        {attachments.length ? <div className="mb-2 flex flex-wrap gap-2">{attachments.map((attachment) => <Badge key={attachment.id} variant="secondary">{attachment.file_name}</Badge>)}</div> : null}
        <div className="flex items-end gap-2"><input ref={fileRef} className="hidden" type="file" onChange={chooseFile} /><Button type="button" variant="outline" size="icon" aria-label="Attach file" onClick={() => fileRef.current?.click()}><PaperclipIcon /></Button><Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a message…" /><Button disabled={send.isPending || (!body.trim() && !attachments.length)}><SendIcon data-icon="inline-start" />Send</Button></div>
      </form>
      <Dialog open={manageOpen} onOpenChange={setManageOpen}><DialogContent><DialogHeader><DialogTitle>Group members and bots</DialogTitle></DialogHeader><div className="flex flex-col gap-3"><div>{detail.data?.members.map((member) => <p key={member.user_id} className="text-sm">{member.display_name} <span className="text-muted-foreground">@{member.username}</span> {member.role === "owner" ? <Badge variant="secondary">Owner</Badge> : null}</p>)}</div><Separator /><Field><FieldLabel htmlFor="group-bot">Add your Bot</FieldLabel><Input id="group-bot" value={botId} onChange={(event) => setBotId(event.target.value)} placeholder="Paste a Bot UUID" /><FieldDescription>Your available Bots: {bots.data?.map((bot) => `${bot.name} (${bot.id})`).join(", ") || "none"}</FieldDescription></Field></div><DialogFooter><Button disabled={!botId || addBot.isPending} onClick={() => addBot.mutate()}><BotIcon data-icon="inline-start" />Add Bot</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}

function MessageRow({ message, mine }: { message: Message; mine: boolean }) {
  return <div className={mine ? "ml-auto max-w-xl" : "max-w-xl"}><div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><span>{message.sender_name}</span>{message.sender_kind === "bot" ? <Badge variant="secondary">Bot</Badge> : null}<time>{new Date(message.created_at * 1000).toLocaleString()}</time></div><Card className={mine ? "bg-primary text-primary-foreground" : ""}><CardContent className="flex flex-col gap-3 p-3">{message.body ? <p className="whitespace-pre-wrap text-sm">{message.body}</p> : null}{message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} />)}</CardContent></Card></div>
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState("")
  useEffect(() => {
    let active = true
    let objectUrl = ""
    void attachmentObjectUrl(attachment.id).then((next) => {
      objectUrl = next
      if (active) setUrl(next)
      else URL.revokeObjectURL(next)
    }).catch(() => undefined)
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachment.id])
  if (attachment.media_type.startsWith("image/")) return url ? <a href={url} target="_blank" rel="noreferrer"><img className="max-h-72 rounded-md object-contain" src={url} alt={attachment.file_name} /></a> : <Badge variant="secondary">Loading {attachment.file_name}</Badge>
  return url ? <a className="flex items-center gap-2 text-sm underline" href={url} download={attachment.file_name}><FileIcon />{attachment.file_name}</a> : <Badge variant="secondary">Loading {attachment.file_name}</Badge>
}

function Directory() {
  const [query, setQuery] = useState("")
  const people = useQuery({ queryKey: ["people", query], queryFn: () => api<Profile[]>(`/api/users?query=${encodeURIComponent(query)}`) })
  return <Page title="Directory" description="Find people by their name or username."><div className="mb-5 flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /><Button variant="outline"><SearchIcon data-icon="inline-start" />Search</Button></div><div className="grid gap-3 sm:grid-cols-2">{people.data?.map((profile) => <ProfileCard key={profile.user_id} profile={profile} />)}</div></Page>
}

function Person() {
  const { username = "" } = useParams()
  const person = useQuery({ queryKey: ["person", username], queryFn: () => api<Profile>(`/api/users/${username}`) })
  const navigate = useNavigate()
  const open = useMutation({ mutationFn: () => api<Conversation>(`/api/conversations/direct/${username}`, { method: "POST" }), onSuccess: (conversation) => navigate(`/inbox/${conversation.id}`), onError: (error) => toast.error(error.message) })
  if (person.isPending) return <Page title="Profile" description="Loading…" />
  if (person.isError) return <Page title="Profile" description={person.error.message} />
  return <Page title={person.data.display_name} description={`@${person.data.username}`}><div className="flex flex-col gap-5"><ProfileCard profile={person.data} /><Button className="w-fit" onClick={() => open.mutate()}><MessageCircleIcon data-icon="inline-start" />Message</Button></div></Page>
}

function Compose() {
  const { username = "" } = useParams()
  const navigate = useNavigate()
  const open = useMutation({ mutationFn: () => api<Conversation>(`/api/conversations/direct/${username}`, { method: "POST" }), onSuccess: (conversation) => navigate(`/inbox/${conversation.id}`), onError: (error) => toast.error(error.message) })
  useEffect(() => { open.mutate() }, [open])
  return <Page title="Starting conversation" description={`Opening a direct message with @${username}…`} />
}

function GroupCreator() {
  const [title, setTitle] = useState("")
  const [usernames, setUsernames] = useState("")
  const navigate = useNavigate()
  const create = useMutation({ mutationFn: () => api<Conversation>("/api/conversations", { method: "POST", body: JSON.stringify({ title, usernames: usernames.split(",").map((value) => value.trim()).filter(Boolean) }) }), onSuccess: (conversation) => navigate(`/inbox/${conversation.id}`), onError: (error) => toast.error(error.message) })
  return <Page title="New group" description="Create a shared conversation and invite people by username."><form className="max-w-xl" onSubmit={(event) => { event.preventDefault(); create.mutate() }}><FieldGroup><Field><FieldLabel htmlFor="group-title">Group name</FieldLabel><Input id="group-title" required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field><FieldLabel htmlFor="group-members">Members</FieldLabel><Input id="group-members" value={usernames} onChange={(event) => setUsernames(event.target.value)} placeholder="alex, sam, taylor" /></Field></FieldGroup><Button className="mt-5" disabled={create.isPending}><PlusIcon data-icon="inline-start" />Create group</Button></form></Page>
}

function Bots() {
  const queryClient = useQueryClient()
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => api<Bot[]>("/api/bots") })
  const [dialog, setDialog] = useState(false)
  const [name, setName] = useState("")
  const [token, setToken] = useState("")
  const create = useMutation({ mutationFn: () => api<{ token: string; id: string }>("/api/bots", { method: "POST", body: JSON.stringify({ name }) }), onSuccess: (created) => { setToken(created.token); void queryClient.invalidateQueries({ queryKey: ["bots"] }) }, onError: (error) => toast.error(error.message) })
  return <Page title="Bots" description="Create bots with a simple sk- token. The token is only shown at creation or rotation."><div className="mb-5"><Button onClick={() => { setDialog(true); setToken(""); setName("") }}><PlusIcon data-icon="inline-start" />New bot</Button></div><div className="grid gap-3 sm:grid-cols-2">{bots.data?.map((bot) => <Card key={bot.id}><CardHeader><CardTitle className="flex items-center gap-2"><BotIcon />{bot.name}</CardTitle><CardDescription>{bot.id}</CardDescription></CardHeader><CardContent><Badge variant="secondary">{bot.token_prefix}…</Badge></CardContent></Card>)}</div><Dialog open={dialog} onOpenChange={setDialog}><DialogContent><DialogHeader><DialogTitle>New bot</DialogTitle></DialogHeader>{token ? <Field><FieldLabel>Copy this token now</FieldLabel><Input readOnly value={token} /></Field> : <Field><FieldLabel htmlFor="bot-name">Name</FieldLabel><Input id="bot-name" value={name} onChange={(event) => setName(event.target.value)} /></Field>}<DialogFooter>{token ? <Button onClick={() => setDialog(false)}>Done</Button> : <Button disabled={!name || create.isPending} onClick={() => create.mutate()}><BotIcon data-icon="inline-start" />Create bot</Button>}</DialogFooter></DialogContent></Dialog></Page>
}

function ProfileEditor({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState(me.profile?.username ?? "")
  const [displayName, setDisplayName] = useState(me.profile?.display_name ?? "")
  const [motto, setMotto] = useState(me.profile?.motto ?? "")
  const [avatar, setAvatar] = useState(me.profile?.avatar_attachment_id ?? "")
  const fileRef = useRef<HTMLInputElement>(null)
  const save = useMutation({ mutationFn: () => api<Profile>("/api/profile", { method: "PUT", body: JSON.stringify({ username, display_name: displayName, motto, avatar_attachment_id: avatar || undefined }) }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["me"] }); toast.success("Profile saved") }, onError: (error) => toast.error(error.message) })
  const chooseAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; try { const attachment = await upload(file); if (!attachment.media_type.startsWith("image/")) throw new Error("Avatar must be an image"); setAvatar(attachment.id) } catch (error) { toast.error(error instanceof Error ? error.message : "Upload failed") }; event.target.value = "" }
  return <Page title="Your profile" description="This is what people find in Linkit’s directory."><form className="max-w-xl" onSubmit={(event) => { event.preventDefault(); save.mutate() }}><FieldGroup><Field><FieldLabel>Avatar</FieldLabel><div className="flex items-center gap-3"><ProfileAvatar profile={avatar ? { ...me.profile, avatar_attachment_id: avatar } : me.profile} /><input ref={fileRef} className="hidden" type="file" accept="image/*" onChange={chooseAvatar} /><Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><ImageIcon data-icon="inline-start" />Upload image</Button></div></Field><Field><FieldLabel htmlFor="username">Username</FieldLabel><Input id="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></Field><Field><FieldLabel htmlFor="display-name">Nickname</FieldLabel><Input id="display-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field><Field><FieldLabel htmlFor="motto">Motto</FieldLabel><Textarea id="motto" value={motto} onChange={(event) => setMotto(event.target.value)} /></Field></FieldGroup><Button className="mt-5" disabled={save.isPending}><UserRoundIcon data-icon="inline-start" />Save profile</Button></form></Page>
}

function ProfileCard({ profile }: { profile: Profile }) {
  return <Link to={profileRoute(profile.username)}><Card className="h-full hover:bg-muted/50"><CardContent className="flex items-center gap-3 p-4"><ProfileAvatar profile={profile} /><div className="min-w-0"><p className="truncate font-medium">{profile.display_name}</p><p className="truncate text-sm text-muted-foreground">@{profile.username}</p><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{profile.motto}</p></div></CardContent></Card></Link>
}

function ProfileAvatar({ profile }: { profile?: Partial<Profile> }) {
  const fallback = profile?.display_name?.slice(0, 1).toUpperCase() ?? "?"
  const [url, setUrl] = useState("")
  useEffect(() => {
    const id = profile?.avatar_attachment_id
    if (!id) { setUrl(""); return }
    let active = true
    let objectUrl = ""
    void attachmentObjectUrl(id).then((next) => { objectUrl = next; if (active) setUrl(next); else URL.revokeObjectURL(next) }).catch(() => undefined)
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [profile?.avatar_attachment_id])
  return <Avatar><AvatarImage src={url || undefined} alt={profile?.display_name ?? ""} /><AvatarFallback>{fallback}</AvatarFallback></Avatar>
}

function Page({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-4xl p-6"><header className="mb-6"><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-1 text-muted-foreground">{description}</p></header>{children}</div>
}
