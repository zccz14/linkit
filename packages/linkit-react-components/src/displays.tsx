import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { HTMLAttributes, ImgHTMLAttributes } from "react";
import type { LinkitConversation, LinkitProfile } from "./types.js";

export type LinkitAvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  profile?: Pick<LinkitProfile, "display_name" | "avatar_url"> | null;
  size?: "sm" | "md" | "lg";
  fallback?: string;
};

export function LinkitAvatar({ profile, size = "md", fallback, className, ...props }: LinkitAvatarProps) {
  const label = profile?.display_name?.trim() || fallback || "?";
  const initial = Array.from(label)[0]?.toLocaleUpperCase() ?? "?";
  const sizeClass = size === "sm" ? "size-6 text-[0.65rem]" : size === "lg" ? "size-10 text-base" : "size-7 text-xs";
  return <span className={twMerge(clsx("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground", sizeClass, className))} aria-label={label}>
    {profile?.avatar_url ? <img {...props} className="size-full object-cover" src={profile.avatar_url} alt="" /> : initial}
  </span>;
}

export type LinkitUserDisplayProps = HTMLAttributes<HTMLSpanElement> & {
  profile?: LinkitProfile | null;
  userId?: string;
  compact?: boolean;
  showUsername?: boolean;
  unknownLabel?: string;
};

export function LinkitUserDisplay({ profile, userId, compact = false, showUsername = false, unknownLabel = "Unknown user", className, ...props }: LinkitUserDisplayProps) {
  const displayName = profile?.display_name?.trim();
  const fallback = !displayName;
  const label = displayName || unknownLabel;
  return <span {...props} className={twMerge(clsx("inline-flex min-w-0 items-center gap-2", className))}>
    <LinkitAvatar profile={profile} size={compact ? "sm" : "md"} fallback={label} />
    <span className="min-w-0">
      <span className="block truncate font-medium">{label}</span>
      {fallback && userId ? <code className="block max-w-full truncate font-mono text-xs text-muted-foreground" title={userId}>{userId}</code> : null}
      {!fallback && showUsername && profile?.username ? <span className="block truncate text-xs text-muted-foreground">@{profile.username}</span> : null}
    </span>
  </span>;
}

export type LinkitConversationDisplayProps = HTMLAttributes<HTMLSpanElement> & {
  conversation: LinkitConversation;
  compact?: boolean;
};

export function LinkitConversationDisplay({ conversation, compact = false, className, ...props }: LinkitConversationDisplayProps) {
  const group = conversation.kind === "group";
  const label = group ? conversation.title || "Group" : conversation.counterpart?.display_name || conversation.title || "Direct message";
  return <span {...props} className={twMerge(clsx("inline-flex min-w-0 items-center gap-2", className))}>
    {group ? <span className={clsx("inline-grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground", compact ? "size-6 text-[0.6rem]" : "size-7 text-[0.7rem]")}>{conversation.avatar_url ? <img className="size-full rounded-full object-cover" src={conversation.avatar_url} alt="" /> : "#"}</span> : <LinkitAvatar profile={conversation.counterpart} size={compact ? "sm" : "md"} fallback={label} />}
    <span className="min-w-0"><span className="block truncate font-medium">{label}</span>{!compact && group ? <span className="block text-xs text-muted-foreground">Group</span> : null}</span>
  </span>;
}
