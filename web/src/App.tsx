import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthMiniApi } from "auth-mini/sdk/browser";
import { AuthMiniProvider, useAuthMini } from "auth-mini-react-components";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  BellIcon,
  BotIcon,
  ChevronLeftIcon,
  FileIcon,
  ImageIcon,
  LogOutIcon,
  MessageCircleIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { LanguageMenu } from "@/components/language-menu";
import { useI18n } from "@/components/use-i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  api,
  attachmentObjectUrl,
  openPagePath,
  publicApi,
  subscribeToEvents,
  upload,
  type Attachment,
  type Bot,
  type Config,
  type Conversation,
  type ConversationDetail,
  type Me,
  type Message,
  type Profile,
  type SystemOverview,
} from "@/lib/api";
import {
  announceIncomingMessage,
  prepareMessageAlertTone,
} from "@/lib/message-alert";

const profileRoute = (username: string) =>
  `/people/${encodeURIComponent(username)}`;

export default function App() {
  const { t } = useI18n();
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => publicApi<Config>("/api/config"),
  });

  useEffect(() => {
    if (!window.location.search) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${openPagePath()}`,
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  if (config.isPending)
    return <LoadingScreen>{t("app.loading")}</LoadingScreen>;
  if (config.isError)
    return <LoadingScreen>{config.error.message}</LoadingScreen>;
  if (config.data.setup_required) return <Setup />;
  if (!config.data.auth_issuer)
    return <LoadingScreen>{t("app.authIssuerMissing")}</LoadingScreen>;
  return (
    <AuthMiniProvider
      autoRedirectToLogin={true}
      authMiniBaseUrl={config.data.auth_issuer}
      callbackUrl={callbackUrl}
      onAuthError={(error) => toast.error(error.message)}
    >
      <AuthedApp />
    </AuthMiniProvider>
  );
}

function callbackUrl() {
  return window.location.href;
}

function LoadingScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center">
      <div className="absolute top-4 right-4">
        <LanguageMenu />
      </div>
      {children}
    </main>
  );
}

function Setup() {
  const [rootUserId, setRootUserId] = useState("");
  const [issuer, setIssuer] = useState("https://auth.ntnl.io");
  const [audience, setAudience] = useState(window.location.hostname);
  const [origin, setOrigin] = useState(window.location.origin);
  return (
    <AuthMiniProvider
      autoRedirectToLogin={false}
      authMiniBaseUrl={issuer}
      callbackUrl={callbackUrl}
      onAuthError={(error) => toast.error(error.message)}
    >
      <SetupForm
        audience={audience}
        issuer={issuer}
        onAudienceChange={setAudience}
        onIssuerChange={setIssuer}
        onOriginChange={setOrigin}
        onRootUserIdChange={setRootUserId}
        origin={origin}
        rootUserId={rootUserId}
      />
    </AuthMiniProvider>
  );
}

function SetupForm({
  audience,
  issuer,
  onAudienceChange,
  onIssuerChange,
  onOriginChange,
  onRootUserIdChange,
  origin,
  rootUserId,
}: {
  audience: string;
  issuer: string;
  onAudienceChange: (value: string) => void;
  onIssuerChange: (value: string) => void;
  onOriginChange: (value: string) => void;
  onRootUserIdChange: (value: string) => void;
  origin: string;
  rootUserId: string;
}) {
  const { t } = useI18n();
  const { isAuthenticated, isReady, sdk, signIn } = useAuthMini();
  const mutation = useMutation({
    mutationFn: () =>
      api(sdk!, "/api/setup", {
        method: "POST",
        body: JSON.stringify({
          root_user_id: rootUserId,
          auth_issuer: issuer,
          auth_audience: audience,
          public_origin: origin,
        }),
      }),
    onSuccess: () => window.location.reload(),
    onError: (error) => toast.error(error.message),
  });

  return (
    <main className="relative mx-auto flex min-h-screen max-w-xl items-center px-5 py-10">
      <div className="absolute top-4 right-4">
        <LanguageMenu />
      </div>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("setup.title")}</CardTitle>
          <CardDescription>{t("setup.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="root-user-id">
                  {t("setup.rootUserId")}
                </FieldLabel>
                <Input
                  id="root-user-id"
                  required
                  value={rootUserId}
                  onChange={(event) => onRootUserIdChange(event.target.value)}
                />
                <FieldDescription>
                  {t("setup.rootUserIdDescription")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="auth-issuer">
                  {t("setup.authIssuer")}
                </FieldLabel>
                <Input
                  id="auth-issuer"
                  required
                  type="url"
                  value={issuer}
                  onChange={(event) => onIssuerChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="audience">
                  {t("setup.audience")}
                </FieldLabel>
                <Input
                  id="audience"
                  required
                  value={audience}
                  onChange={(event) => onAudienceChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="public-origin">
                  {t("setup.publicOrigin")}
                </FieldLabel>
                <Input
                  id="public-origin"
                  required
                  type="url"
                  value={origin}
                  onChange={(event) => onOriginChange(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap gap-2">
              {!isAuthenticated ? (
                <Button type="button" variant="outline" onClick={signIn}>
                  {t("setup.signIn")}
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={!isReady || !isAuthenticated || mutation.isPending}
              >
                {mutation.isPending
                  ? t("setup.initializing")
                  : t("setup.initialize")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Toaster richColors />
    </main>
  );
}

function AuthedApp() {
  const { t } = useI18n();
  const { error, isAuthenticated, isReady, sdk } = useAuthMini();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>(sdk!, "/api/me"),
    enabled: Boolean(sdk && isAuthenticated),
  });
  if (error) return <LoadingScreen>{error.message}</LoadingScreen>;
  if (!isReady || !isAuthenticated || !sdk || me.isPending)
    return <LoadingScreen>{t("app.restoring")}</LoadingScreen>;
  if (me.isError) return <LoadingScreen>{me.error.message}</LoadingScreen>;
  if (!me.data.profile) return <ProfileEditor me={me.data} sdk={sdk} />;
  return <Shell me={me.data} sdk={sdk} />;
}

function Shell({ me, sdk }: { me: Me; sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const { signOut } = useAuthMini();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<Conversation[]>(sdk, "/api/conversations"),
    refetchInterval: 4_000,
  });
  const [notificationPermission, setNotificationPermission] = useState(
    () => window.Notification?.permission,
  );
  useEffect(() => {
    window.addEventListener("pointerdown", prepareMessageAlertTone, {
      once: true,
    });
    window.addEventListener("keydown", prepareMessageAlertTone, {
      once: true,
    });
    return () => {
      window.removeEventListener("pointerdown", prepareMessageAlertTone);
      window.removeEventListener("keydown", prepareMessageAlertTone);
    };
  }, []);
  useEffect(
    () =>
      subscribeToEvents(sdk, (event) => {
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
        void queryClient.invalidateQueries({
          queryKey: ["messages", event.conversation_id],
        });
        if (event.sender_id !== me.id)
          announceIncomingMessage({
            title: t("notification.title"),
            body: t("notification.body"),
          });
      }),
    [me.id, queryClient, sdk, t],
  );
  const links = [
    ["/directory", t("navigation.directory"), UsersRoundIcon],
    ["/bots", t("navigation.bots"), BotIcon],
    ["/settings/profile", t("navigation.profile"), SettingsIcon],
    ...(me.root
      ? [["/admin/system", t("navigation.admin"), ShieldCheckIcon] as const]
      : []),
  ] as const;

  const conversationRoute = (id: string) => `/conversations/${id}`;
  const mobileNavigationVisible =
    isMobile &&
    !/^\/conversations\/[^/]+(?:\/manage)?$/.test(location.pathname);
  const conversationList = (
    <ConversationList
      conversations={conversations.data ?? []}
      currentPath={location.pathname}
      sdk={sdk}
      onOpen={(conversation) => navigate(conversationRoute(conversation.id))}
    />
  );

  return (
    <div className="grid min-h-dvh grid-cols-[17rem_1fr] bg-muted/30 max-md:grid-cols-1">
      <aside className="flex min-h-dvh flex-col gap-4 border-r bg-background p-4 max-md:hidden">
        <Link
          className="flex items-center gap-2 px-2 text-lg font-semibold"
          to="/conversations"
        >
          <MessageCircleIcon />
          Linkit
        </Link>
        <nav className="flex flex-col gap-1">
          {links.map(([to, label, Icon]) => (
            <Button
              key={to}
              variant={location.pathname === to ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => navigate(to)}
            >
              <Icon data-icon="inline-start" />
              {label}
            </Button>
          ))}
        </nav>
        <Separator />
        <div className="flex items-center justify-between px-2 text-sm text-muted-foreground">
          <span>{t("navigation.conversations")}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("navigation.newGroup")}
            onClick={() => navigate("/groups/new")}
          >
            <PlusIcon />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{conversationList}</div>
        <div className="mt-auto flex items-center gap-2 border-t pt-4">
          <ProfileAvatar profile={me.profile} sdk={sdk} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {me.profile!.display_name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              @{me.profile!.username}
            </p>
          </div>
          {notificationPermission === "default" ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("notification.enable")}
              onClick={() =>
                void window.Notification?.requestPermission().then(
                  setNotificationPermission,
                )
              }
            >
              <BellIcon />
            </Button>
          ) : null}
          <LanguageMenu />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("auth.signOut")}
            onClick={() => void signOut()}
          >
            <LogOutIcon />
          </Button>
        </div>
      </aside>
      <main className="min-w-0">
        <Routes>
          <Route
            path="/conversations"
            element={
              <ConversationIndex
                conversations={conversations.data ?? []}
                sdk={sdk}
              />
            }
          />
          <Route
            path="/conversations/:id"
            element={<ConversationPage me={me} sdk={sdk} />}
          />
          <Route
            path="/conversations/:id/manage"
            element={<MobileGroupManager me={me} sdk={sdk} />}
          />
          <Route path="/directory" element={<Directory sdk={sdk} />} />
          <Route path="/people/:username" element={<Person sdk={sdk} />} />
          <Route path="/compose/:username" element={<Compose sdk={sdk} />} />
          <Route path="/groups/new" element={<GroupCreator sdk={sdk} />} />
          <Route path="/bots" element={<Bots sdk={sdk} />} />
          <Route
            path="/settings/profile"
            element={<ProfileEditor me={me} sdk={sdk} />}
          />
          <Route path="/admin/system" element={<SystemDashboard sdk={sdk} />} />
          <Route path="*" element={<Navigate to="/conversations" replace />} />
        </Routes>
      </main>
      {mobileNavigationVisible ? <MobileNavigator /> : null}
      <Toaster richColors />
    </div>
  );
}

function ConversationIndex({
  conversations,
  sdk,
}: {
  conversations: Conversation[];
  sdk: AuthMiniApi;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  if (!isMobile) return <ConversationEmpty />;
  return (
    <div className="min-h-dvh bg-background">
      <MobileAppHeader title={t("conversation.listTitle")} />
      <ConversationListPage conversations={conversations} sdk={sdk} />
    </div>
  );
}

function ConversationEmpty() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleIcon />
          </EmptyMedia>
          <EmptyTitle>{t("conversation.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("conversation.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function ConversationList({
  conversations,
  currentPath,
  sdk,
  onOpen,
}: {
  conversations: Conversation[];
  currentPath: string;
  sdk: AuthMiniApi;
  onOpen: (conversation: Conversation) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      {conversations.map((conversation) => {
        const label =
          conversation.title ||
          conversation.counterpart_name ||
          t("conversation.direct");
        return (
          <Button
            key={conversation.id}
            variant={
              currentPath === `/conversations/${conversation.id}`
                ? "secondary"
                : "ghost"
            }
            className="h-auto justify-start gap-3 px-2 py-2 text-left"
            onClick={() => onOpen(conversation)}
          >
            <ConversationAvatar conversation={conversation} sdk={sdk} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{label}</span>
              {conversation.latest_body ? (
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {conversation.latest_body}
                </span>
              ) : null}
            </span>
            {conversation.unread_count ? (
              <Badge>{conversation.unread_count}</Badge>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

function ConversationListPage({
  conversations,
  sdk,
}: {
  conversations: Conversation[];
  sdk: AuthMiniApi;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col p-3 pb-20">
      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          {t("navigation.conversations")}
        </p>
        <Button size="sm" onClick={() => navigate("/groups/new")}>
          <PlusIcon data-icon="inline-start" />
          {t("navigation.newGroup")}
        </Button>
      </div>
      {conversations.length ? (
        <ConversationList
          conversations={conversations}
          currentPath={location.pathname}
          sdk={sdk}
          onOpen={(conversation) =>
            navigate(`/conversations/${conversation.id}`)
          }
        />
      ) : (
        <div className="grid flex-1 place-items-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircleIcon />
              </EmptyMedia>
              <EmptyTitle>{t("conversation.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("conversation.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </div>
  );
}

function ConversationAvatar({
  conversation,
  sdk,
}: {
  conversation: Conversation;
  sdk: AuthMiniApi;
}) {
  const { t } = useI18n();
  if (conversation.kind === "group")
    return (
      <Avatar>
        <AvatarFallback aria-label={t("group.title")}>
          <UsersRoundIcon />
        </AvatarFallback>
      </Avatar>
    );
  return (
    <ProfileAvatar
      sdk={sdk}
      profile={{
        display_name: conversation.counterpart_name,
        avatar_attachment_id: conversation.counterpart_avatar_attachment_id,
      }}
    />
  );
}

function MobileAppHeader({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="flex min-h-14 items-center gap-2 border-b px-3">
      {onBack ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("conversation.back")}
          onClick={onBack}
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
      {action}
    </header>
  );
}

function MobileNavigator() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const items = [
    ["/conversations", t("navigation.inbox"), MessageCircleIcon],
    ["/directory", t("navigation.directory"), UsersRoundIcon],
    ["/bots", t("navigation.bots"), BotIcon],
    ["/settings/profile", t("navigation.profile"), SettingsIcon],
  ] as const;
  return (
    <nav className="fixed right-0 bottom-0 left-0 z-40 grid grid-cols-4 border-t bg-background/95 px-2 py-1 backdrop-blur md:hidden">
      {items.map(([to, label, Icon]) => (
        <Button
          key={to}
          variant={location.pathname === to ? "secondary" : "ghost"}
          className="h-12 flex-col gap-0.5 px-1 text-[0.7rem]"
          onClick={() => navigate(to)}
        >
          <Icon />
          {label}
        </Button>
      ))}
    </nav>
  );
}

function SystemDashboard({ sdk }: { sdk: AuthMiniApi }) {
  const { locale, t } = useI18n();
  const overview = useQuery({
    queryKey: ["admin", "system"],
    queryFn: () => api<SystemOverview>(sdk, "/api/admin/system"),
    refetchInterval: 5_000,
  });
  if (overview.isPending)
    return <LoadingScreen>{t("profile.loading")}</LoadingScreen>;
  if (overview.isError)
    return <LoadingScreen>{overview.error.message}</LoadingScreen>;

  const data = overview.data;
  return (
    <Page title={t("admin.title")} description={t("admin.description")}>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("admin.updated", {
          time: new Date(data.generated_at * 1000).toLocaleTimeString(locale),
        })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          label={t("admin.cpu")}
          value={`${data.cpu_usage_percent.toFixed(1)}%`}
        />
        <MetricCard
          label={t("admin.memory")}
          value={t("admin.used", {
            used: byteSize(data.used_memory_bytes),
            total: byteSize(data.total_memory_bytes),
          })}
        />
        <MetricCard
          label={t("admin.network")}
          value={`${t("admin.receive")} ${byteRate(data.received_bytes_per_second)} · ${t("admin.transmit")} ${byteRate(data.transmitted_bytes_per_second)}`}
          detail={`${t("admin.total")}: ↓ ${byteSize(data.received_bytes_total)} · ↑ ${byteSize(data.transmitted_bytes_total)}`}
        />
        <MetricCard
          label={t("admin.sqlite")}
          value={byteSize(data.sqlite_bytes)}
        />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("admin.disk")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.disks.map((disk) => (
            <div
              key={disk.mount_point}
              className="flex flex-wrap items-center justify-between gap-2 border-b pb-4 last:border-0 last:pb-0"
            >
              <div>
                <p className="font-medium">{disk.mount_point}</p>
                <p className="text-sm text-muted-foreground">
                  {t("admin.used", {
                    used: byteSize(disk.total_bytes - disk.available_bytes),
                    total: byteSize(disk.total_bytes),
                  })}
                </p>
              </div>
              <Badge variant="secondary">
                {t("admin.available")}: {byteSize(disk.available_bytes)}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </Page>
  );
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {detail ? <CardDescription>{detail}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}

function byteSize(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function byteRate(bytes: number) {
  return `${byteSize(bytes)}/s`;
}

function ConversationPage({ me, sdk }: { me: Me; sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const messages = useQuery({
    queryKey: ["messages", id],
    queryFn: () => api<Message[]>(sdk, `/api/conversations/${id}/messages`),
    refetchInterval: 3_000,
  });
  const detail = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api<ConversationDetail>(sdk, `/api/conversations/${id}`),
  });
  const send = useMutation({
    mutationFn: () =>
      api<Message>(sdk, `/api/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body,
          attachment_ids: attachments.map((attachment) => attachment.id),
        }),
      }),
    onSuccess: () => {
      setBody("");
      setAttachments([]);
      void queryClient.invalidateQueries({ queryKey: ["messages", id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    void api(sdk, `/api/conversations/${id}/read`, { method: "POST" }).catch(
      () => undefined,
    );
  }, [id, sdk]);
  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const attachment = await upload(sdk, file);
      setAttachments((current) => [...current, attachment]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("profileEditor.uploadError"),
      );
    }
    event.target.value = "";
  };
  const sendMessage = () => {
    if (send.isPending || (!body.trim() && !attachments.length)) return;
    send.mutate();
  };
  const title =
    detail.data?.title ||
    detail.data?.counterpart_name ||
    t("conversation.direct");
  const manageGroup = () => {
    if (isMobile) navigate(`/conversations/${id}/manage`);
    else setManageOpen(true);
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      {isMobile ? (
        <MobileAppHeader
          title={title}
          onBack={() => navigate("/conversations")}
          action={
            detail.data?.kind === "group" ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("conversation.members")}
                onClick={manageGroup}
              >
                <UsersRoundIcon />
              </Button>
            ) : undefined
          }
        />
      ) : (
        <header className="flex min-h-14 items-center gap-2 border-b px-6">
          <MessageCircleIcon />
          <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
          {detail.data?.kind === "group" ? (
            <Button variant="outline" size="sm" onClick={manageGroup}>
              <UsersRoundIcon data-icon="inline-start" />
              {t("conversation.members")}
            </Button>
          ) : null}
        </header>
      )}
      <section className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="flex flex-col gap-4">
          {messages.data?.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              mine={
                message.sender_kind === "user" && message.sender_id === me.id
              }
              sdk={sdk}
            />
          ))}
        </div>
      </section>
      <form
        className="shrink-0 border-t p-3 md:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        {attachments.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <Badge key={attachment.id} variant="secondary">
                {attachment.file_name}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            onChange={chooseFile}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("conversation.attachFile")}
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <Textarea
            rows={1}
            className="min-h-9 max-h-36 resize-none"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder={t("conversation.writeMessage")}
          />
          <Button
            type="submit"
            disabled={send.isPending || (!body.trim() && !attachments.length)}
          >
            <SendIcon data-icon="inline-start" />
            {t("conversation.send")}
          </Button>
        </div>
      </form>
      <Drawer
        open={manageOpen}
        onOpenChange={setManageOpen}
        swipeDirection="right"
      >
        <DrawerContent className="[--drawer-content-width:28rem]">
          <DrawerHeader>
            <DrawerTitle>{t("conversation.manageTitle")}</DrawerTitle>
          </DrawerHeader>
          {detail.data ? (
            <GroupManagementContent detail={detail.data} me={me} sdk={sdk} />
          ) : null}
          <DrawerFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              {t("bots.done")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function MobileGroupManager({ me, sdk }: { me: Me; sdk: AuthMiniApi }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api<ConversationDetail>(sdk, `/api/conversations/${id}`),
  });
  if (detail.isPending)
    return <LoadingScreen>{t("profile.loading")}</LoadingScreen>;
  if (detail.isError)
    return <LoadingScreen>{detail.error.message}</LoadingScreen>;
  if (detail.data.kind !== "group")
    return <Navigate to={`/conversations/${id}`} replace />;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <MobileAppHeader
        title={t("conversation.manageTitle")}
        onBack={() => navigate(`/conversations/${id}`)}
      />
      <GroupManagementContent detail={detail.data} me={me} sdk={sdk} />
    </div>
  );
}

function GroupManagementContent({
  detail,
  me,
  sdk,
}: {
  detail: ConversationDetail;
  me: Me;
  sdk: AuthMiniApi;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [botId, setBotId] = useState("");
  const bots = useQuery({
    queryKey: ["bots"],
    queryFn: () => api<Bot[]>(sdk, "/api/bots"),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["conversation", detail.id],
    });
  const addMember = useMutation({
    mutationFn: () =>
      api(sdk, `/api/conversations/${detail.id}/members`, {
        method: "POST",
        body: JSON.stringify({ username }),
      }),
    onSuccess: () => {
      setUsername("");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const removeMember = useMutation({
    mutationFn: (memberUsername: string) =>
      api(sdk, `/api/conversations/${detail.id}/members`, {
        method: "DELETE",
        body: JSON.stringify({ username: memberUsername }),
      }),
    onSuccess: () => {
      refresh();
      toast.success(t("conversation.removeMemberSuccess"));
    },
    onError: (error) => toast.error(error.message),
  });
  const addBot = useMutation({
    mutationFn: () =>
      api(sdk, `/api/bots/${botId}/groups/${detail.id}`, { method: "POST" }),
    onSuccess: () => {
      setBotId("");
      refresh();
      toast.success(t("conversation.addBotSuccess"));
    },
    onError: (error) => toast.error(error.message),
  });
  const removeBot = useMutation({
    mutationFn: (id: string) =>
      api(sdk, `/api/bots/${id}/groups/${detail.id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast.success(t("conversation.removeBotSuccess"));
    },
    onError: (error) => toast.error(error.message),
  });
  const isOwner = detail.members.some(
    (member) => member.user_id === me.id && member.role === "owner",
  );
  const availableBots = (bots.data ?? []).filter(
    (bot) => !detail.bots.some((member) => member.id === bot.id),
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t("conversation.members")}</h2>
            <Badge variant="secondary">{detail.members.length}</Badge>
          </div>
          <div className="flex flex-col gap-1">
            {detail.members.map((member) => (
              <div
                key={member.user_id}
                className="flex items-center gap-3 rounded-lg px-2 py-2"
              >
                <Avatar>
                  <AvatarFallback>
                    {member.display_name.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.display_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{member.username}
                  </p>
                </div>
                {member.role === "owner" ? (
                  <Badge variant="secondary">{t("conversation.owner")}</Badge>
                ) : null}
                {isOwner && member.role !== "owner" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("conversation.removeMember")}
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(member.username)}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {isOwner ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (username.trim()) addMember.mutate();
              }}
            >
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t("conversation.memberPlaceholder")}
              />
              <Button
                type="submit"
                disabled={!username.trim() || addMember.isPending}
              >
                <PlusIcon data-icon="inline-start" />
                {t("conversation.addMember")}
              </Button>
            </form>
          ) : null}
        </section>
        <Separator />
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t("navigation.bots")}</h2>
            <Badge variant="secondary">{detail.bots.length}</Badge>
          </div>
          {detail.bots.length ? (
            <div className="flex flex-col gap-1">
              {detail.bots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2"
                >
                  <Avatar>
                    <AvatarFallback>
                      <BotIcon />
                    </AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {bot.name}
                  </p>
                  {isOwner ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("conversation.removeBot")}
                      disabled={removeBot.isPending}
                      onClick={() => removeBot.mutate(bot.id)}
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {isOwner ? (
            <Field>
              <FieldLabel>{t("conversation.addBot")}</FieldLabel>
              <div className="flex gap-2">
                <Select
                  value={botId || null}
                  onValueChange={(value) => setBotId(value ?? "")}
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder={t("conversation.selectBot")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {availableBots.map((bot) => (
                        <SelectItem key={bot.id} value={bot.id}>
                          {bot.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  disabled={!botId || addBot.isPending}
                  onClick={() => addBot.mutate()}
                >
                  <BotIcon data-icon="inline-start" />
                  {t("conversation.addBot")}
                </Button>
              </div>
            </Field>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  mine,
  sdk,
}: {
  message: Message;
  mine: boolean;
  sdk: AuthMiniApi;
}) {
  const { locale, t } = useI18n();
  return (
    <div className={mine ? "ml-auto max-w-xl" : "max-w-xl"}>
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{message.sender_name}</span>
        {message.sender_kind === "bot" ? (
          <Badge variant="secondary">{t("conversation.bot")}</Badge>
        ) : null}
        <time>
          {new Date(message.created_at * 1000).toLocaleString(locale)}
        </time>
      </div>
      <Card className={mine ? "bg-primary text-primary-foreground" : ""}>
        <CardContent className="flex flex-col gap-3 p-3">
          {message.body ? (
            <p className="whitespace-pre-wrap text-sm">{message.body}</p>
          ) : null}
          {message.attachments.map((attachment) => (
            <AttachmentView
              key={attachment.id}
              attachment={attachment}
              sdk={sdk}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AttachmentView({
  attachment,
  sdk,
}: {
  attachment: Attachment;
  sdk: AuthMiniApi;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void attachmentObjectUrl(sdk, attachment.id)
      .then((next) => {
        objectUrl = next;
        if (active) setUrl(next);
        else URL.revokeObjectURL(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, sdk]);
  if (attachment.media_type.startsWith("image/"))
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        <img
          className="max-h-72 rounded-md object-contain"
          src={url}
          alt={attachment.file_name}
        />
      </a>
    ) : (
      <Badge variant="secondary">
        {t("attachment.loading", { name: attachment.file_name })}
      </Badge>
    );
  return url ? (
    <a
      className="flex items-center gap-2 text-sm underline"
      href={url}
      download={attachment.file_name}
    >
      <FileIcon />
      {attachment.file_name}
    </a>
  ) : (
    <Badge variant="secondary">
      {t("attachment.loading", { name: attachment.file_name })}
    </Badge>
  );
}

function Directory({ sdk }: { sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const people = useQuery({
    queryKey: ["people", query],
    queryFn: () =>
      api<Profile[]>(sdk, `/api/users?query=${encodeURIComponent(query)}`),
  });
  return (
    <Page title={t("directory.title")} description={t("directory.description")}>
      <div className="mb-5 flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("directory.searchPlaceholder")}
        />
        <Button variant="outline">
          <SearchIcon data-icon="inline-start" />
          {t("directory.search")}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {people.data?.map((profile) => (
          <ProfileCard key={profile.user_id} profile={profile} sdk={sdk} />
        ))}
      </div>
    </Page>
  );
}

function Person({ sdk }: { sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const { username = "" } = useParams();
  const person = useQuery({
    queryKey: ["person", username],
    queryFn: () => api<Profile>(sdk, `/api/users/${username}`),
  });
  const navigate = useNavigate();
  const open = useMutation({
    mutationFn: () =>
      api<Conversation>(sdk, `/api/conversations/direct/${username}`, {
        method: "POST",
      }),
    onSuccess: (conversation) => navigate(`/conversations/${conversation.id}`),
    onError: (error) => toast.error(error.message),
  });
  if (person.isPending)
    return (
      <Page title={t("profile.title")} description={t("profile.loading")} />
    );
  if (person.isError)
    return (
      <Page title={t("profile.title")} description={person.error.message} />
    );
  return (
    <Page
      title={person.data.display_name}
      description={`@${person.data.username}`}
    >
      <div className="flex flex-col gap-5">
        <ProfileCard profile={person.data} sdk={sdk} />
        <Button className="w-fit" onClick={() => open.mutate()}>
          <MessageCircleIcon data-icon="inline-start" />
          {t("profile.message")}
        </Button>
      </div>
    </Page>
  );
}

function Compose({ sdk }: { sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const open = useMutation({
    mutationFn: () =>
      api<Conversation>(sdk, `/api/conversations/direct/${username}`, {
        method: "POST",
      }),
    onSuccess: (conversation) => navigate(`/conversations/${conversation.id}`),
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    open.mutate();
  }, [open]);
  return (
    <Page
      title={t("compose.title")}
      description={t("compose.description", { username })}
    />
  );
}

function GroupCreator({ sdk }: { sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [usernames, setUsernames] = useState("");
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () =>
      api<Conversation>(sdk, "/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          title,
          usernames: usernames
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      }),
    onSuccess: (conversation) => navigate(`/conversations/${conversation.id}`),
    onError: (error) => toast.error(error.message),
  });
  return (
    <Page title={t("group.title")} description={t("group.description")}>
      <form
        className="max-w-xl"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="group-title">{t("group.name")}</FieldLabel>
            <Input
              id="group-title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-members">
              {t("group.members")}
            </FieldLabel>
            <Input
              id="group-members"
              value={usernames}
              onChange={(event) => setUsernames(event.target.value)}
              placeholder={t("group.membersPlaceholder")}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" className="mt-5" disabled={create.isPending}>
          <PlusIcon data-icon="inline-start" />
          {t("group.create")}
        </Button>
      </form>
    </Page>
  );
}

function Bots({ sdk }: { sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const bots = useQuery({
    queryKey: ["bots"],
    queryFn: () => api<Bot[]>(sdk, "/api/bots"),
  });
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [selected, setSelected] = useState<Bot>();
  const [ownerUsername, setOwnerUsername] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api<{ token: string; id: string }>(sdk, "/api/bots", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (created) => {
      setToken(created.token);
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const update = useMutation({
    mutationFn: ({ body, id }: { id: string; body: object }) =>
      api<{ token?: string }>(sdk, `/api/bots/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (result) => {
      if (result.token) setToken(result.token);
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success(t("bots.updated"));
    },
    onError: (error) => toast.error(error.message),
  });
  const dialogTitle = selected
    ? t("bots.manageTitle", { name: selected.name })
    : t("bots.newTitle");
  return (
    <Page title={t("bots.title")} description={t("bots.description")}>
      <div className="mb-5">
        <Button
          onClick={() => {
            setDialog(true);
            setSelected(undefined);
            setToken("");
            setName("");
          }}
        >
          <PlusIcon data-icon="inline-start" />
          {t("bots.new")}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {bots.data?.map((bot) => (
          <Card key={bot.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BotIcon />
                {bot.name}
              </CardTitle>
              <CardDescription>{bot.id}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <Badge variant="secondary">{bot.token_prefix}…</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelected(bot);
                  setOwnerUsername("");
                  setToken("");
                  setDialog(true);
                }}
              >
                {t("bots.manage")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {token ? (
            <Field>
              <FieldLabel>{t("bots.copyToken")}</FieldLabel>
              <Input readOnly value={token} />
            </Field>
          ) : selected ? (
            <FieldGroup>
              <Field>
                <FieldLabel>{t("bots.uuid")}</FieldLabel>
                <Input readOnly value={selected.id} />
              </Field>
              <Field>
                <FieldLabel htmlFor="bot-owner">
                  {t("bots.transferOwnership")}
                </FieldLabel>
                <Input
                  id="bot-owner"
                  value={ownerUsername}
                  onChange={(event) => setOwnerUsername(event.target.value)}
                  placeholder={t("bots.ownerPlaceholder")}
                />
              </Field>
            </FieldGroup>
          ) : (
            <Field>
              <FieldLabel htmlFor="bot-name">{t("bots.name")}</FieldLabel>
              <Input
                id="bot-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          <DialogFooter>
            {token ? (
              <Button onClick={() => setDialog(false)}>{t("bots.done")}</Button>
            ) : selected ? (
              <>
                <Button
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({
                      id: selected.id,
                      body: { rotate_token: true },
                    })
                  }
                >
                  {t("bots.rotateToken")}
                </Button>
                <Button
                  disabled={!ownerUsername || update.isPending}
                  onClick={() =>
                    update.mutate({
                      id: selected.id,
                      body: { new_owner_username: ownerUsername },
                    })
                  }
                >
                  {t("bots.transferOwner")}
                </Button>
              </>
            ) : (
              <Button
                disabled={!name || create.isPending}
                onClick={() => create.mutate()}
              >
                <BotIcon data-icon="inline-start" />
                {t("bots.create")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function ProfileEditor({ me, sdk }: { me: Me; sdk: AuthMiniApi }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(me.profile?.username ?? "");
  const [displayName, setDisplayName] = useState(
    me.profile?.display_name ?? "",
  );
  const [motto, setMotto] = useState(me.profile?.motto ?? "");
  const [avatar, setAvatar] = useState(me.profile?.avatar_attachment_id ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () =>
      api<Profile>(sdk, "/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          username,
          display_name: displayName,
          motto,
          avatar_attachment_id: avatar || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success(t("profileEditor.saved"));
    },
    onError: (error) => toast.error(error.message),
  });
  const chooseAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const attachment = await upload(sdk, file);
      if (!attachment.media_type.startsWith("image/"))
        throw new Error(t("profileEditor.avatarError"));
      setAvatar(attachment.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("profileEditor.uploadError"),
      );
    }
    event.target.value = "";
  };
  return (
    <Page
      title={t("profileEditor.title")}
      description={t("profileEditor.description")}
      localeControl={!me.profile}
    >
      <form
        className="max-w-xl"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel>{t("profileEditor.avatar")}</FieldLabel>
            <div className="flex items-center gap-3">
              <ProfileAvatar
                sdk={sdk}
                profile={
                  avatar
                    ? { ...me.profile, avatar_attachment_id: avatar }
                    : me.profile
                }
              />
              <input
                ref={fileRef}
                className="hidden"
                type="file"
                accept="image/*"
                onChange={chooseAvatar}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                <ImageIcon data-icon="inline-start" />
                {t("profileEditor.uploadImage")}
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="username">
              {t("profileEditor.username")}
            </FieldLabel>
            <Input
              id="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="display-name">
              {t("profileEditor.nickname")}
            </FieldLabel>
            <Input
              id="display-name"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="motto">{t("profileEditor.motto")}</FieldLabel>
            <Textarea
              id="motto"
              value={motto}
              onChange={(event) => setMotto(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" className="mt-5" disabled={save.isPending}>
          <UserRoundIcon data-icon="inline-start" />
          {t("profileEditor.save")}
        </Button>
      </form>
    </Page>
  );
}

function ProfileCard({ profile, sdk }: { profile: Profile; sdk: AuthMiniApi }) {
  return (
    <Link to={profileRoute(profile.username)}>
      <Card className="h-full hover:bg-muted/50">
        <CardContent className="flex items-center gap-3 p-4">
          <ProfileAvatar profile={profile} sdk={sdk} />
          <div className="min-w-0">
            <p className="truncate font-medium">{profile.display_name}</p>
            <p className="truncate text-sm text-muted-foreground">
              @{profile.username}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {profile.motto}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ProfileAvatar({
  profile,
  sdk,
}: {
  profile?: Partial<Profile>;
  sdk: AuthMiniApi;
}) {
  const fallback = profile?.display_name?.slice(0, 1).toUpperCase() ?? "?";
  const [url, setUrl] = useState("");
  useEffect(() => {
    const id = profile?.avatar_attachment_id;
    if (!id) {
      setUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    void attachmentObjectUrl(sdk, id)
      .then((next) => {
        objectUrl = next;
        if (active) setUrl(next);
        else URL.revokeObjectURL(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profile?.avatar_attachment_id, sdk]);
  return (
    <Avatar>
      <AvatarImage src={url || undefined} alt={profile?.display_name ?? ""} />
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  );
}

function Page({
  title,
  description,
  children,
  localeControl = false,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  localeControl?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl p-6 pb-20 md:pb-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
        {localeControl ? <LanguageMenu /> : null}
      </header>
      {children}
    </div>
  );
}
