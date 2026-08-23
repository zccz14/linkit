import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { useAuthMini } from "auth-mini-react-components";
import { CircleAlertIcon, LoaderCircleIcon, MessageCircleIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useId, useState, type HTMLAttributes } from "react";
import type { LinkitConversation, LinkitProfile } from "./types.js";
import { useLinkit } from "./linkit-provider.js";

export type LinkitUserInfoLabels = {
  unknownUser: string;
  userInformation: string;
  profileUnavailable: string;
  directMessage: string;
  openingDirectMessage: string;
  cannotMessageYourself: string;
  signInToMessage: string;
  popupBlocked: string;
};

export type LinkitUserInfoProps = HTMLAttributes<HTMLSpanElement> & {
  userId: string;
  profile?: LinkitProfile | null;
  lang?: string;
  labels?: Partial<LinkitUserInfoLabels>;
  compact?: boolean;
  onDirectConversation?: (conversation: LinkitConversation) => void;
};

const labelsByLanguage: Record<"en" | "zh", LinkitUserInfoLabels> = {
  en: {
    unknownUser: "Unknown user",
    userInformation: "User information",
    profileUnavailable: "This user's Linkit profile is unavailable.",
    directMessage: "Message",
    openingDirectMessage: "Opening direct message…",
    cannotMessageYourself: "You can't send a direct message to yourself.",
    signInToMessage: "Sign in to send a direct message.",
    popupBlocked: "Your browser blocked the Linkit conversation window.",
  },
  zh: {
    unknownUser: "未知用户",
    userInformation: "用户资料",
    profileUnavailable: "该用户的 Linkit 资料不可用。",
    directMessage: "私信",
    openingDirectMessage: "正在打开私信…",
    cannotMessageYourself: "不能向自己发送私信。",
    signInToMessage: "登录后才能发送私信。",
    popupBlocked: "浏览器阻止了 Linkit 私聊窗口。",
  },
};

export function LinkitUserInfo({ userId, profile: suppliedProfile, lang = "en", labels: labelOverrides, compact = false, className, onDirectConversation, ...props }: LinkitUserInfoProps) {
  const auth = useAuthMini();
  const linkit = useLinkit();
  const titleId = useId();
  const descriptionId = useId();
  const labels = { ...labelsByLanguage[languageKey(lang)], ...labelOverrides };
  const [open, setOpen] = useState(false);
  const [loadedProfile, setLoadedProfile] = useState<LinkitProfile | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = suppliedProfile ?? loadedProfile ?? null;
  const username = profile?.username?.trim() || "";
  const displayName = username || labels.unknownUser;

  useEffect(() => {
    if (!open || suppliedProfile || loadedProfile !== undefined || !userId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void linkit.getProfile(userId)
      .then((next) => { if (active) setLoadedProfile(next); })
      .catch(() => { if (active) setLoadedProfile(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [linkit, loadedProfile, open, suppliedProfile, userId]);

  async function openDirectMessage() {
    if (!username) return;
    if (!auth.isAuthenticated) {
      setError(labels.signInToMessage);
      return;
    }
    const conversationWindow = window.open("", "_blank");
    if (!conversationWindow) {
      setError(labels.popupBlocked);
      return;
    }
    conversationWindow.opener = null;
    setDirecting(true);
    setError(null);
    try {
      const me = await linkit.getMe();
      if (me.id === userId) throw new Error(labels.cannotMessageYourself);
      const conversation = await linkit.openDirectConversation(username);
      conversationWindow.location.replace(conversationUrl(linkit.linkitBaseUrl, conversation.id));
      onDirectConversation?.(conversation);
    } catch (cause) {
      conversationWindow.close();
      setError(message(cause));
    } finally {
      setDirecting(false);
    }
  }

  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
    <PopoverPrimitive.Trigger
      {...props}
      aria-label={`${labels.userInformation}: ${displayName}, ${userId}`}
      className={join("linkit-user-info", compact && "linkit-user-info--compact", className)}
      openOnHover
      delay={180}
      closeDelay={160}
      type="button"
    >
      <UserAvatar profile={profile} label={displayName} compact={compact} />
      <span className="linkit-user-info__copy">
        <span className="linkit-user-info__username" title={displayName}>{displayName}</span>
        <code className="linkit-user-info__id" title={userId}>{userId}</code>
      </span>
    </PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner align="start" side="bottom" sideOffset={8}>
        <PopoverPrimitive.Popup aria-describedby={descriptionId} aria-labelledby={titleId} className="linkit-user-info__popup" initialFocus={false}>
          <PopoverPrimitive.Title id={titleId}>{labels.userInformation}</PopoverPrimitive.Title>
          <PopoverPrimitive.Description id={descriptionId} className="linkit-user-info__visually-hidden">{displayName}</PopoverPrimitive.Description>
          <div className="linkit-user-info__detail">
            <UserAvatar profile={profile} label={displayName} large />
            <div className="linkit-user-info__detail-copy">
              <p className="linkit-user-info__detail-username">{displayName}</p>
              <code className="linkit-user-info__detail-id">{userId}</code>
            </div>
          </div>
          <SeparatorPrimitive className="linkit-user-info__separator" />
          {loading ? <div aria-label={labels.userInformation} className="linkit-user-info__skeleton" role="status"><span /><span /></div> : null}
          {!loading && !username ? <InfoAlert>{labels.profileUnavailable}</InfoAlert> : null}
          {profile?.motto ? <p className="linkit-user-info__motto">{profile.motto}</p> : null}
          {error ? <InfoAlert destructive><CircleAlertIcon aria-hidden="true" />{error}</InfoAlert> : null}
          <ButtonPrimitive className="linkit-user-info__dm" disabled={!username || directing} type="button" onClick={() => void openDirectMessage()}>
            {directing ? <LoaderCircleIcon className="linkit-user-info__spinner" data-icon="inline-start" /> : <MessageCircleIcon data-icon="inline-start" />}
            {directing ? labels.openingDirectMessage : labels.directMessage}
          </ButtonPrimitive>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}

function UserAvatar({ profile, label, compact = false, large = false }: { profile: LinkitProfile | null; label: string; compact?: boolean; large?: boolean }) {
  return <AvatarPrimitive.Root aria-label={label} className="linkit-user-info__avatar" data-compact={compact || undefined} data-large={large || undefined}>
    {profile?.avatar_url ? <AvatarPrimitive.Image alt="" className="linkit-user-info__avatar-image" src={profile.avatar_url} /> : null}
    <AvatarPrimitive.Fallback className="linkit-user-info__avatar-fallback"><UserRoundIcon aria-hidden="true" /></AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>;
}

function InfoAlert({ children, destructive = false }: { children: React.ReactNode; destructive?: boolean }) {
  return <div className="linkit-user-info__alert" data-destructive={destructive || undefined} role={destructive ? "alert" : "status"}>{children}</div>;
}

function conversationUrl(linkitBaseUrl: string, conversationId: string) {
  const url = new URL(linkitBaseUrl);
  url.hash = `/conversations/${encodeURIComponent(conversationId)}`;
  return url.toString();
}

function languageKey(value: string): "en" | "zh" { return value.toLowerCase() === "zh" || value.toLowerCase().startsWith("zh-") ? "zh" : "en"; }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
function join(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(" "); }
