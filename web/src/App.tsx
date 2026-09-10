import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  ArrowDownIcon,
  BellIcon,
  BotIcon,
  CopyIcon,
  ChevronLeftIcon,
  CpuIcon,
  DatabaseIcon,
  FileIcon,
  HardDriveIcon,
  ImageIcon,
  MemoryStickIcon,
  MessageCircleIcon,
  NetworkIcon,
  PaperclipIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SmartphoneIcon,
  Trash2Icon,
  type LucideIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  LinkitProvider,
  LinkitMyInfo,
  LinkitUserPicker,
  useLinkitUserInfo,
} from "linkit-react-components";
import { QRCodeSVG } from "qrcode.react";

import { LanguageMenu } from "@/components/language-menu";
import { useI18n } from "@/components/use-i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Attachment as MessageAttachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
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
  Message as ChatMessage,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { updatedConversationDetail } from "@/lib/conversation";
import { MessageMarkdown } from "@/lib/message-markdown";
import { shouldSendMessageOnEnter } from "@/lib/message";
import {
  api,
  attachmentObjectUrl,
  avatarObjectUrl,
  openPagePath,
  publicApi,
  subscribeToEvents,
  upload,
  type Attachment,
  type BarkNotificationSettings,
  type BarkNotificationUser,
  type Bot,
  type Config,
  type Conversation,
  type ConversationDetail,
  type Me,
  type Message,
  type MessagePage,
  type Profile,
  type SystemOverview,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/locale";

const profileRoute = (username: string) =>
  `/people/${encodeURIComponent(username)}`;

function appendMessage(
  data: InfiniteData<MessagePage> | undefined,
  message: Message,
) {
  if (
    !data ||
    data.pages.some((page) => page.messages.some(({ id }) => id === message.id))
  )
    return data;
  const lastPage = data.pages.length - 1;
  return {
    ...data,
    pages: data.pages.map((page, index) =>
      index === lastPage
        ? { ...page, messages: [...page.messages, message] }
        : page,
    ),
  };
}

export default function App() {
  const { locale, t } = useI18n();
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
      <LinkitProvider
        lang={locale}
        linkitBaseUrl={config.data.public_origin ?? window.location.origin}
      >
        <AuthedApp />
      </LinkitProvider>
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
  return <Shell me={me.data} sdk={sdk} />;
}

function Shell({ me, sdk }: { me: Me; sdk: AuthMiniApi }) {
  const queryClient = useQueryClient();
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<Conversation[]>(sdk, "/api/conversations"),
    refetchInterval: 4_000,
  });
  useEffect(
    () =>
      subscribeToEvents(sdk, (event) => {
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
        queryClient.setQueryData<InfiniteData<MessagePage>>(
          ["messages", event.conversation_id],
          (data) => appendMessage(data, event.message),
        );
      }),
    [queryClient, sdk],
  );

  return (
    <TooltipProvider>
      <SidebarProvider className="h-dvh">
        <LinkitShell
          conversations={conversations.data ?? []}
          me={me}
          sdk={sdk}
        />
      </SidebarProvider>
      <Toaster richColors />
    </TooltipProvider>
  );
}

type NavigationItem = {
  icon: LucideIcon;
  label: string;
  to: string;
};

function LinkitShell({
  conversations,
  me,
  sdk,
}: {
  conversations: Conversation[];
  me: Me;
  sdk: AuthMiniApi;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const workspaceItems: NavigationItem[] = [
    {
      icon: MessageCircleIcon,
      label: t("navigation.inbox"),
      to: "/conversations",
    },
    {
      icon: UsersRoundIcon,
      label: t("navigation.directory"),
      to: "/directory",
    },
  ];
  const toolItems: NavigationItem[] = [
    { icon: BotIcon, label: t("navigation.bots"), to: "/bots" },
    {
      icon: BellIcon,
      label: t("navigation.notifications"),
      to: "/settings/notifications",
    },
  ];
  const systemItems: NavigationItem[] = [
    {
      icon: HardDriveIcon,
      label: t("admin.resources"),
      to: "/admin/resources",
    },
    {
      icon: BellIcon,
      label: t("admin.barkUsers"),
      to: "/admin/bark-users",
    },
  ];
  const goTo = (to: string) => {
    navigate(to);
    if (isMobile) setOpenMobile(false);
  };
  const title = appPageTitle(location.pathname, t);
  const isConversationList = location.pathname === "/conversations";

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-4">
          <Link
            className="flex items-center gap-2 text-lg font-semibold"
            to="/conversations"
            onClick={() => isMobile && setOpenMobile(false)}
          >
            <img
              alt=""
              aria-hidden="true"
              className="size-7 shrink-0"
              src="/linkit-logo.png"
            />
            <span className="group-data-[collapsible=icon]:hidden">Linkit</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNavigationGroup
            items={workspaceItems}
            label={t("navigation.workspace")}
            onNavigate={goTo}
            pathname={location.pathname}
          />
          <SidebarNavigationGroup
            items={toolItems}
            label={t("navigation.tools")}
            onNavigate={goTo}
            pathname={location.pathname}
          />
          {me.root ? (
            <SidebarNavigationGroup
              items={systemItems}
              label={t("navigation.system")}
              onNavigate={goTo}
              pathname={location.pathname}
            />
          ) : null}
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/85">
          <SidebarTrigger />
          <Separator className="h-5" orientation="vertical" />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </h1>
          {isConversationList ? (
            <Button size="sm" onClick={() => navigate("/groups/new")}>
              <PlusIcon data-icon="inline-start" />
              {t("navigation.newGroup")}
            </Button>
          ) : null}
          <LanguageMenu />
          <LinkitMyInfo />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route
              path="/conversations"
              element={
                <ConversationIndex conversations={conversations} sdk={sdk} />
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
              path="/settings/notifications"
              element={<BarkNotifications sdk={sdk} />}
            />
            <Route
              path="/admin/resources"
              element={<SystemResourcesPage sdk={sdk} />}
            />
            <Route
              path="/admin/bark-users"
              element={<AdminBarkUsers sdk={sdk} />}
            />
            <Route
              path="*"
              element={<Navigate to="/conversations" replace />}
            />
          </Routes>
        </div>
      </SidebarInset>
    </>
  );
}

function SidebarNavigationGroup({
  items,
  label,
  onNavigate,
  pathname,
}: {
  items: NavigationItem[];
  label: string;
  onNavigate: (to: string) => void;
  pathname: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={isNavigationActive(pathname, item.to)}
                tooltip={item.label}
                onClick={() => onNavigate(item.to)}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function isNavigationActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function appPageTitle(pathname: string, t: (key: TranslationKey) => string) {
  if (pathname.startsWith("/conversations")) return t("conversation.listTitle");
  if (pathname.startsWith("/directory")) return t("directory.title");
  if (pathname.startsWith("/people")) return t("profile.title");
  if (pathname.startsWith("/compose")) return t("compose.title");
  if (pathname.startsWith("/groups")) return t("group.title");
  if (pathname.startsWith("/bots")) return t("bots.title");
  if (pathname.startsWith("/settings/notifications"))
    return t("barkSettings.title");
  if (pathname.startsWith("/settings/profile")) return t("profile.title");
  if (pathname.startsWith("/admin/resources")) return t("admin.resources");
  if (pathname.startsWith("/admin/bark-users"))
    return t("admin.barkUsersTitle");
  if (pathname.startsWith("/admin")) return t("navigation.admin");
  return t("conversation.listTitle");
}

function ConversationIndex({
  conversations,
  sdk,
}: {
  conversations: Conversation[];
  sdk: AuthMiniApi;
}) {
  return <ConversationListPage conversations={conversations} sdk={sdk} />;
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
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col p-4 md:p-6">
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
        <div className="grid min-h-72 flex-1 place-items-center">
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
      <ProfileAvatar
        sdk={sdk}
        profile={{
          username: conversation.title || t("group.title"),
          avatar_attachment_id: conversation.avatar_attachment_id,
        }}
      />
    );
  return (
    <ProfileAvatar
      sdk={sdk}
      profile={{
        username: conversation.counterpart_name,
        avatar_attachment_id: conversation.counterpart_avatar_attachment_id,
      }}
    />
  );
}

function ConversationSubheader({
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
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 md:px-6">
      {onBack ? (
        <Button
          variant="ghost"
          size="icon-sm"
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

function SystemResourcesPage({ sdk }: { sdk: AuthMiniApi }) {
  const { locale, t } = useI18n();
  const overview = useQuery({
    queryKey: ["admin", "resources"],
    queryFn: () => api<SystemOverview>(sdk, "/api/admin/resources"),
    refetchInterval: 5_000,
  });
  if (overview.isPending)
    return <LoadingScreen>{t("profile.loading")}</LoadingScreen>;
  if (overview.isError)
    return <LoadingScreen>{overview.error.message}</LoadingScreen>;

  const data = overview.data;
  return (
    <Page
      title={t("admin.resources")}
      description={t("admin.resourcesDescription")}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {t("admin.updated", {
          time: new Date(data.generated_at * 1000).toLocaleTimeString(locale),
        })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          icon={CpuIcon}
          label={t("admin.cpu")}
          value={`${data.cpu_usage_percent.toFixed(1)}%`}
          detail={t("admin.cpuDetail", {
            load: data.cpu_load_1m.toFixed(2),
            count: String(data.logical_cpu_count),
          })}
        />
        <MetricCard
          icon={MemoryStickIcon}
          label={t("admin.memory")}
          value={t("admin.used", {
            used: byteSize(data.used_memory_bytes),
            total: byteSize(data.total_memory_bytes),
          })}
          detail={t("admin.memoryDetail", {
            available: byteSize(data.available_memory_bytes),
            swapUsed: byteSize(data.used_swap_bytes),
            swapTotal: byteSize(data.total_swap_bytes),
          })}
        />
        <MetricCard
          icon={NetworkIcon}
          label={t("admin.network")}
          value={`${t("admin.receive")} ${byteRate(data.received_bytes_per_second)} · ${t("admin.transmit")} ${byteRate(data.transmitted_bytes_per_second)}`}
          detail={t("admin.networkDetail", {
            count: String(data.network_interface_count),
            received: byteSize(data.received_bytes_total),
            transmitted: byteSize(data.transmitted_bytes_total),
          })}
        />
        <MetricCard
          icon={HardDriveIcon}
          label={t("admin.disk")}
          value={
            data.disk
              ? t("admin.used", {
                  used: byteSize(data.disk.used_bytes),
                  total: byteSize(data.disk.total_bytes),
                })
              : "—"
          }
          detail={
            data.disk
              ? t("admin.diskDetail", {
                  available: byteSize(data.disk.available_bytes),
                  mountPoint: data.disk.mount_point,
                })
              : t("admin.resourceUnavailable")
          }
        />
        <MetricCard
          icon={DatabaseIcon}
          label={t("admin.sqlite")}
          value={byteSize(data.sqlite.total_bytes)}
          detail={t("admin.sqliteDetail", {
            main: byteSize(data.sqlite.main_bytes),
            wal: byteSize(data.sqlite.wal_bytes),
            shm: byteSize(data.sqlite.shm_bytes),
          })}
        />
      </div>
    </Page>
  );
}

function AdminBarkUsers({ sdk }: { sdk: AuthMiniApi }) {
  const { locale, t } = useI18n();
  const users = useQuery({
    queryKey: ["admin", "bark-users"],
    queryFn: () => api<BarkNotificationUser[]>(sdk, "/api/admin/bark-users"),
  });
  if (users.isPending)
    return <LoadingScreen>{t("profile.loading")}</LoadingScreen>;
  if (users.isError)
    return <LoadingScreen>{users.error.message}</LoadingScreen>;
  return (
    <Page
      title={t("admin.barkUsersTitle")}
      description={t("admin.barkUsersPageDescription")}
    >
      {users.data.length ? (
        <div
          className="divide-y rounded-lg border"
          aria-label={t("admin.barkUsersTitle")}
        >
          {users.data.map((user) => (
            <div
              key={user.username}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{user.username}</p>
                <p className="truncate text-sm text-muted-foreground">
                  @{user.username}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground sm:justify-end">
                <Badge variant="secondary">
                  {t("admin.barkUsersDevices", {
                    count: String(user.device_count),
                  })}
                </Badge>
                <span>
                  {t("admin.barkUsersLastUpdated", {
                    time: new Date(
                      user.last_device_updated_at * 1000,
                    ).toLocaleString(locale),
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyTitle>{t("admin.barkUsersEmptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("admin.barkUsersEmptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Page>
  );
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail?: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon />
          {label}
        </CardDescription>
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
  const [urgent, setUrgent] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const messages = useInfiniteQuery({
    queryKey: ["messages", id],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<MessagePage>(sdk, `/api/conversations/${id}/messages${pageParam}`),
    getPreviousPageParam: (page) =>
      page.older_cursor
        ? `?before_cursor=${encodeURIComponent(page.older_cursor)}`
        : undefined,
    getNextPageParam: (page) =>
      page.newer_cursor
        ? `?after_cursor=${encodeURIComponent(page.newer_cursor)}`
        : undefined,
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
          urgent,
        }),
      }),
    onSuccess: (message) => {
      setBody("");
      setAttachments([]);
      setUrgent(false);
      queryClient.setQueryData<InfiniteData<MessagePage>>(
        ["messages", id],
        (data) => appendMessage(data, message),
      );
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConversationSubheader
        title={title}
        onBack={() => navigate("/conversations")}
        action={
          detail.data?.kind === "group" ? (
            <Button variant="outline" size="sm" onClick={manageGroup}>
              <UsersRoundIcon data-icon="inline-start" />
              <span className="max-sm:sr-only">
                {t("conversation.members")}
              </span>
            </Button>
          ) : undefined
        }
      />
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="h-auto flex-1">
          <MessageScrollerViewport className="p-4 md:p-6" aria-label={title}>
            <MessageScrollerContent className="gap-4">
              {messages.hasPreviousPage ? (
                <MessageScrollerItem messageId="load-earlier-messages">
                  <Button
                    className="self-center"
                    variant="ghost"
                    size="sm"
                    disabled={messages.isFetchingPreviousPage}
                    onClick={() => void messages.fetchPreviousPage()}
                  >
                    {messages.isFetchingPreviousPage
                      ? t("conversation.loadingOlder")
                      : t("conversation.loadOlder")}
                  </Button>
                </MessageScrollerItem>
              ) : null}
              {messages.data?.pages
                .flatMap((page) => page.messages)
                .map((message) => {
                  const mine =
                    message.sender_kind === "user" &&
                    message.sender_id === me.id;
                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={mine}
                    >
                      <MessageRow message={message} mine={mine} sdk={sdk} />
                    </MessageScrollerItem>
                  );
                })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton>
            <ArrowDownIcon data-icon="inline-start" />
            <span className="sr-only">{t("conversation.scrollToLatest")}</span>
          </MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={urgent}
              type="checkbox"
              onChange={(event) => setUrgent(event.target.checked)}
            />
            {t("conversation.urgent")}
          </label>
          {urgent ? (
            <span className="text-xs font-medium text-destructive">
              {t("conversation.urgentNotice")}
            </span>
          ) : null}
        </div>
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
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (
                !shouldSendMessageOnEnter({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing:
                    event.nativeEvent.isComposing || composingRef.current,
                })
              )
                return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder={t("conversation.writeMessage")}
            aria-describedby="conversation-compose-hint"
          />
          <Button
            type="submit"
            disabled={send.isPending || (!body.trim() && !attachments.length)}
          >
            <SendIcon data-icon="inline-start" />
            {t("conversation.send")}
          </Button>
        </div>
        <p
          id="conversation-compose-hint"
          className="mt-2 text-xs text-muted-foreground"
        >
          {t("conversation.composeHint")}
        </p>
      </form>
      {!isMobile ? (
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
      ) : null}
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConversationSubheader
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
  const [groupTitle, setGroupTitle] = useState(detail.title);
  const [groupAvatar, setGroupAvatar] = useState(
    detail.avatar_attachment_id ?? "",
  );
  const [username, setUsername] = useState("");
  useEffect(() => {
    setGroupTitle(detail.title);
    setGroupAvatar(detail.avatar_attachment_id ?? "");
  }, [detail.avatar_attachment_id, detail.id, detail.title]);
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["conversation", detail.id],
    });
  const updateGroup = useMutation({
    mutationFn: (input: {
      title?: string;
      avatar_attachment_id?: string | null;
    }) =>
      api<Conversation>(sdk, `/api/conversations/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (conversation) => {
      setGroupTitle(conversation.title);
      setGroupAvatar(conversation.avatar_attachment_id ?? "");
      queryClient.setQueryData<ConversationDetail>(
        ["conversation", detail.id],
        (current) => updatedConversationDetail(current, conversation),
      );
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const saveGroupTitle = () => {
    if (!groupTitle.trim()) return;
    updateGroup.mutate({ title: groupTitle });
  };
  const chooseGroupAvatar = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const attachment = await upload(sdk, file);
      updateGroup.mutate({ avatar_attachment_id: attachment.id });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("profileEditor.uploadError"),
      );
    }
  };

  const addMember = useMutation({
    mutationFn: async () => {
      const member = await api<Profile>(
        sdk,
        `/api/users/${encodeURIComponent(username.trim())}`,
      );
      return api(sdk, `/api/conversations/${detail.id}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: member.user_id }),
      });
    },
    onSuccess: () => {
      setUsername("");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const removeMember = useMutation({
    mutationFn: (memberUserId: string) =>
      api(sdk, `/api/conversations/${detail.id}/members`, {
        method: "DELETE",
        body: JSON.stringify({ user_id: memberUserId }),
      }),
    onSuccess: () => {
      refresh();
      toast.success(t("conversation.removeMemberSuccess"));
    },
    onError: (error) => toast.error(error.message),
  });
  const isOwner = detail.members.some(
    (member) => member.user_id === me.id && member.role === "owner",
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="flex flex-col gap-6">
        {isOwner ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{t("conversation.groupName")}</h2>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveGroupTitle();
              }}
            >
              <Input
                value={groupTitle}
                onChange={(event) => setGroupTitle(event.target.value)}
                aria-label={t("conversation.groupName")}
                maxLength={120}
                required
              />
              <Button
                type="submit"
                disabled={!groupTitle.trim() || updateGroup.isPending}
              >
                {t("conversation.saveGroupName")}
              </Button>
            </form>
            <Field>
              <FieldLabel htmlFor="group-avatar">
                {t("conversation.groupAvatar")}
              </FieldLabel>
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  sdk={sdk}
                  profile={{
                    username: detail.title,
                    avatar_attachment_id: groupAvatar || undefined,
                  }}
                />
                <Input
                  id="group-avatar"
                  type="file"
                  accept="image/*"
                  disabled={updateGroup.isPending}
                  onChange={(event) => void chooseGroupAvatar(event)}
                />
                {groupAvatar ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={updateGroup.isPending}
                    onClick={() =>
                      updateGroup.mutate({ avatar_attachment_id: null })
                    }
                  >
                    {t("conversation.removeGroupAvatar")}
                  </Button>
                ) : null}
              </div>
              <FieldDescription>
                {t("conversation.groupAvatarHint")}
              </FieldDescription>
            </Field>
          </section>
        ) : null}
        {isOwner ? <Separator /> : null}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t("conversation.members")}</h2>
            <Badge variant="secondary">{detail.members.length}</Badge>
          </div>
          <div className="flex flex-col gap-1">
            {detail.members.map((member) => (
              <GroupMemberRow
                key={member.user_id}
                member={member}
                canRemove={isOwner && member.role !== "owner"}
                removing={removeMember.isPending}
                onRemove={(userId) => removeMember.mutate(userId)}
              />
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
      </div>
    </div>
  );
}

function GroupMemberRow({
  canRemove,
  member,
  onRemove,
  removing,
}: {
  canRemove: boolean;
  member: ConversationDetail["members"][number];
  onRemove: (userId: string) => void;
  removing: boolean;
}) {
  const { t } = useI18n();
  const { note, profile } = useLinkitUserInfo(member.user_id);
  const displayName = note?.name || profile?.username || member.username;
  const avatarFallback =
    Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? "?";
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2">
      <Avatar aria-label={displayName}>
        <AvatarImage src={profile?.avatar_url ?? undefined} alt="" />
        <AvatarFallback>{avatarFallback}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          @{member.username}
        </p>
      </div>
      {member.role === "owner" ? (
        <Badge variant="secondary">{t("conversation.owner")}</Badge>
      ) : null}
      {member.user_type === "bot" ? (
        <Badge variant="secondary">{t("conversation.bot")}</Badge>
      ) : null}
      {canRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("conversation.removeMember")}
          disabled={removing}
          onClick={() => onRemove(member.user_id)}
        >
          <XIcon />
        </Button>
      ) : null}
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
  const { note, profile } = useLinkitUserInfo(message.sender_id);
  const senderName = message.sender_deleted
    ? t("conversation.deletedBot")
    : note?.name ||
      profile?.username ||
      message.sender_name ||
      message.sender_id;
  const avatarFallback =
    Array.from(senderName.trim())[0]?.toLocaleUpperCase() ?? "?";
  return (
    <ChatMessage align={mine ? "end" : "start"}>
      <MessageAvatar>
        <Avatar aria-label={senderName}>
          <AvatarImage src={profile?.avatar_url ?? undefined} alt="" />
          <AvatarFallback>{avatarFallback}</AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader className="gap-2">
          <span className="min-w-0 truncate" title={senderName}>
            {senderName}
          </span>
          <time className="shrink-0">
            {new Date(message.created_at * 1000).toLocaleString(locale)}
          </time>
        </MessageHeader>
        <Bubble
          align={mine ? "end" : "start"}
          variant={mine ? "default" : "secondary"}
        >
          <BubbleContent>
            <div className="flex flex-col gap-3">
              {message.body ? (
                <MessageMarkdown>{message.body}</MessageMarkdown>
              ) : null}
              {message.sender_kind === "bot" ? (
                <Badge variant="secondary">{t("conversation.bot")}</Badge>
              ) : null}
              {message.urgent ? (
                <Badge variant="destructive">{t("conversation.urgent")}</Badge>
              ) : null}
              {message.attachments.map((attachment) => (
                <AttachmentView
                  key={attachment.id}
                  attachment={attachment}
                  sdk={sdk}
                />
              ))}
            </div>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </ChatMessage>
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
  const image = attachment.media_type.startsWith("image/");
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
  return (
    <MessageAttachment size="sm" state={url ? "done" : "processing"}>
      <AttachmentMedia variant={image ? "image" : "icon"}>
        {image && url ? (
          <img src={url} alt={attachment.file_name} />
        ) : image ? (
          <ImageIcon />
        ) : (
          <FileIcon />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.file_name}</AttachmentTitle>
        <AttachmentDescription>
          {url
            ? byteSize(attachment.byte_size)
            : t("attachment.loading", { name: attachment.file_name })}
        </AttachmentDescription>
      </AttachmentContent>
      {url ? (
        <AttachmentTrigger
          aria-label={attachment.file_name}
          render={
            <a
              href={url}
              target={image ? "_blank" : undefined}
              rel={image ? "noreferrer" : undefined}
              download={image ? undefined : attachment.file_name}
            />
          }
        />
      ) : null}
    </MessageAttachment>
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
    queryFn: () =>
      api<Profile>(sdk, `/api/users/${encodeURIComponent(username)}`),
  });
  const navigate = useNavigate();
  const open = useMutation({
    mutationFn: () =>
      api<Conversation>(
        sdk,
        `/api/conversations/direct/${encodeURIComponent(username)}`,
        {
          method: "POST",
        },
      ),
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
    <Page title={person.data.username} description={`@${person.data.username}`}>
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
      api<Conversation>(
        sdk,
        `/api/conversations/direct/${encodeURIComponent(username)}`,
        {
          method: "POST",
        },
      ),
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
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () =>
      api<Conversation>(sdk, "/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          title,
          user_ids: memberIds,
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
            <LinkitUserPicker
              multiple
              value={memberIds}
              onValueChange={(userIds) => setMemberIds(userIds)}
              label={t("group.members")}
              lang={document.documentElement.lang}
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
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
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
      api<Bot & { token?: string }>(sdk, `/api/bots/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (result) => {
      if (result.token) setToken(result.token);
      setSelected(result);
      setName(result.name);
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success(t("bots.updated"));
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<void>(sdk, `/api/bots/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteConfirmation(false);
      setDialog(false);
      setSelected(undefined);
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success(t("bots.deleted"));
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
                  setName(bot.name);
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
                <FieldLabel htmlFor="bot-name">{t("bots.name")}</FieldLabel>
                <Input
                  id="bot-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
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
                  disabled={
                    !name.trim() || name === selected.name || update.isPending
                  }
                  onClick={() =>
                    update.mutate({ id: selected.id, body: { name } })
                  }
                >
                  {t("bots.saveName")}
                </Button>
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
                <Button
                  variant="destructive"
                  disabled={update.isPending}
                  onClick={() => setDeleteConfirmation(true)}
                >
                  {t("bots.delete")}
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
      <AlertDialog
        open={deleteConfirmation}
        onOpenChange={setDeleteConfirmation}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selected
                ? t("bots.deleteTitle", { name: selected.name })
                : t("bots.delete")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("bots.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("bots.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!selected || remove.isPending}
              onClick={() => selected && remove.mutate(selected.id)}
            >
              {t("bots.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function BarkNotifications({ sdk }: { sdk: AuthMiniApi }) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<"reset" | "revoke" | null>(
    null,
  );
  const settings = useQuery({
    queryKey: ["settings", "bark"],
    queryFn: () => api<BarkNotificationSettings>(sdk, "/api/settings/bark"),
  });
  const reset = useMutation({
    mutationFn: () =>
      api<BarkNotificationSettings>(sdk, "/api/settings/bark", {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "bark"] });
      setConfirmation(null);
      toast.success(t("barkSettings.resetDone"));
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: () => api(sdk, "/api/settings/bark", { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "bark"] });
      setConfirmation(null);
      toast.success(t("barkSettings.revoked"));
    },
    onError: (error) => toast.error(error.message),
  });
  const removeDevice = useMutation({
    mutationFn: (id: string) =>
      api(sdk, `/api/settings/bark/devices/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "bark"] });
      toast.success(t("barkSettings.deviceRemoved"));
    },
    onError: (error) => toast.error(error.message),
  });
  const baseUrl = settings.data?.base_url ?? "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(baseUrl);
      toast.success(t("barkSettings.copied"));
    } catch {
      toast.error(t("barkSettings.copyFailed"));
    }
  };

  return (
    <Page
      title={t("barkSettings.title")}
      description={t("barkSettings.description")}
    >
      <div className="grid max-w-3xl gap-5 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BellIcon aria-hidden="true" />
            </div>
            <div>
              <CardTitle>{t("barkSettings.cardTitle")}</CardTitle>
              <CardDescription className="mt-1">
                {t("barkSettings.cardDescription")}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("barkSettings.iosPrompt")}{" "}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href="https://apps.apple.com/app/bark-customed-notifications/id1403753865"
                target="_blank"
                rel="noreferrer"
              >
                {t("barkSettings.downloadBark")}
              </a>
            </p>
            {settings.isLoading ? (
              <p className="text-sm text-muted-foreground">
                {t("barkSettings.loading")}
              </p>
            ) : null}
            {baseUrl ? (
              <>
                <Field>
                  <FieldLabel htmlFor="bark-base-url">
                    {t("barkSettings.baseUrl")}
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="bark-base-url"
                      readOnly
                      value={baseUrl}
                      aria-describedby="bark-base-url-help"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("barkSettings.copy")}
                      onClick={() => void copy()}
                    >
                      <CopyIcon aria-hidden="true" />
                    </Button>
                  </div>
                  <FieldDescription id="bark-base-url-help">
                    {t("barkSettings.baseUrlHint")}
                  </FieldDescription>
                </Field>
                {!settings.data?.apns_configured ? (
                  <p className="text-sm text-destructive">
                    {t("barkSettings.apnsUnavailable")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reset.isPending}
                    onClick={() => setConfirmation("reset")}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    {t("barkSettings.reset")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={revoke.isPending}
                    onClick={() => setConfirmation("revoke")}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    {t("barkSettings.revoke")}
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">
              {t("barkSettings.scanTitle")}
            </CardTitle>
            <CardDescription>
              {t("barkSettings.scanDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            {baseUrl ? (
              <div className="rounded-lg bg-white p-3 ring-1 ring-foreground/10">
                <QRCodeSVG value={baseUrl} size={164} level="M" includeMargin />
              </div>
            ) : (
              <div className="grid size-44 place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
                {t("barkSettings.loading")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-5 max-w-3xl">
        <CardHeader>
          <CardTitle>{t("barkSettings.devicesTitle")}</CardTitle>
          <CardDescription>
            {t("barkSettings.devicesDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings.data?.devices.length ? (
            <ul
              className="divide-y rounded-lg border"
              aria-label={t("barkSettings.devicesTitle")}
            >
              {settings.data.devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  <SmartphoneIcon
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{t("barkSettings.device")}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(device.updated_at * 1000).toLocaleString(
                        locale,
                      )}
                    </p>
                  </div>
                  <code className="ml-auto text-xs text-muted-foreground">
                    {device.id.slice(0, 8)}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("barkSettings.removeDevice")}
                    disabled={removeDevice.isPending}
                    onClick={() => removeDevice.mutate(device.id)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("barkSettings.noDevices")}
            </p>
          )}
        </CardContent>
      </Card>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "reset"
                ? t("barkSettings.resetConfirmTitle")
                : t("barkSettings.revokeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "reset"
                ? t("barkSettings.resetConfirmDescription")
                : t("barkSettings.revokeConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmation === "reset" ? reset.mutate() : revoke.mutate()
              }
            >
              {confirmation === "reset"
                ? t("barkSettings.reset")
                : t("barkSettings.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function ProfileCard({ profile, sdk }: { profile: Profile; sdk: AuthMiniApi }) {
  const { note } = useLinkitUserInfo(profile.user_id);
  const displayName = note?.name || profile.username;
  return (
    <Link to={profileRoute(profile.username)}>
      <Card className="h-full hover:bg-muted/50">
        <CardContent className="flex items-center gap-3 p-4">
          <ProfileAvatar profile={profile} sdk={sdk} />
          <div className="min-w-0">
            <p className="truncate font-medium">{displayName}</p>
            {note ? (
              <p className="truncate text-xs text-muted-foreground">
                @{profile.username}
              </p>
            ) : null}
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {profile.intro}
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
  const fallback = profile?.username?.slice(0, 1).toUpperCase() ?? "?";
  const [url, setUrl] = useState("");
  useEffect(() => {
    const id = profile?.avatar_attachment_id;
    if (!id) {
      setUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    void avatarObjectUrl(sdk, id)
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
      <AvatarImage src={url || undefined} alt={profile?.username ?? ""} />
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
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
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
