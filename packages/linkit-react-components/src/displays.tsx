import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useState, type HTMLAttributes, type ImgHTMLAttributes } from "react";
import type { LinkitConversation, LinkitProfile } from "./types.js";

export type LinkitAvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  profile?: Pick<LinkitProfile, "username" | "avatar_url"> | null;
  size?: "sm" | "md" | "lg";
  fallback?: string;
};

export function LinkitAvatar({ profile, size = "md", fallback, className, onError, ...props }: LinkitAvatarProps) {
  const label = profile?.username?.trim() || fallback || "?";
  const initial = Array.from(label)[0]?.toLocaleUpperCase() ?? "?";
  const avatarUrl = profile?.avatar_url ?? null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);
  return <span className={twMerge(clsx("linkit-avatar", `linkit-avatar--${size}`, className))} aria-label={label}>
    {showImage ? <img {...props} className="linkit-avatar__image" src={avatarUrl!} alt="" onError={(event) => {
      setFailedUrl(avatarUrl);
      onError?.(event);
    }} /> : null}
    {!showImage ? <span className="linkit-avatar__fallback" aria-hidden="true">{initial}</span> : null}
  </span>;
}

export type LinkitUserDisplayProps = HTMLAttributes<HTMLSpanElement> & {
  profile?: LinkitProfile | null;
  userId?: string;
  compact?: boolean;
  unknownLabel?: string;
};

export function LinkitUserDisplay({ profile, userId, compact = false, unknownLabel = "Unknown user", className, ...props }: LinkitUserDisplayProps) {
  const username = profile?.username?.trim();
  const fallback = !username;
  const label = username || unknownLabel;
  return <span {...props} className={twMerge(clsx("inline-flex min-w-0 items-center gap-2", className))}>
    <LinkitAvatar profile={profile} size={compact ? "sm" : "md"} fallback={label} />
    <span className="min-w-0">
      <span className="block truncate font-medium">{label}</span>
      {fallback && userId ? <code className="block max-w-full truncate font-mono text-xs text-muted-foreground" title={userId}>{userId}</code> : null}
    </span>
  </span>;
}

export type LinkitConversationDisplayProps = HTMLAttributes<HTMLSpanElement> & {
  conversation: LinkitConversation;
  compact?: boolean;
};

export function LinkitConversationDisplay({ conversation, compact = false, className, ...props }: LinkitConversationDisplayProps) {
  const group = conversation.kind === "group";
  const label = group ? conversation.title || "Group" : conversation.counterpart?.username || conversation.counterpart_name || conversation.title || "Direct message";
  return <span {...props} className={twMerge(clsx("inline-flex min-w-0 items-center gap-2", className))}>
    {group ? <span className={clsx("inline-grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground", compact ? "size-6 text-[0.6rem]" : "size-7 text-[0.7rem]")}>{conversation.avatar_url ? <img className="size-full rounded-full object-cover" src={conversation.avatar_url} alt="" /> : "#"}</span> : <LinkitAvatar profile={conversation.counterpart} size={compact ? "sm" : "md"} fallback={label} />}
    <span className="min-w-0"><span className="block truncate font-medium">{label}</span>{!compact && group ? <span className="block text-xs text-muted-foreground">Group</span> : null}</span>
  </span>;
}
