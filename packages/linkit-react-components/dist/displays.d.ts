import type { HTMLAttributes, ImgHTMLAttributes } from "react";
import type { LinkitConversation, LinkitProfile } from "./types.js";
export type LinkitAvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
    profile?: Pick<LinkitProfile, "display_name" | "avatar_url"> | null;
    size?: "sm" | "md" | "lg";
    fallback?: string;
};
export declare function LinkitAvatar({ profile, size, fallback, className, ...props }: LinkitAvatarProps): import("react").JSX.Element;
export type LinkitUserDisplayProps = HTMLAttributes<HTMLSpanElement> & {
    profile?: LinkitProfile | null;
    userId?: string;
    compact?: boolean;
    showUsername?: boolean;
};
export declare function LinkitUserDisplay({ profile, userId, compact, showUsername, className, ...props }: LinkitUserDisplayProps): import("react").JSX.Element;
export type LinkitConversationDisplayProps = HTMLAttributes<HTMLSpanElement> & {
    conversation: LinkitConversation;
    compact?: boolean;
};
export declare function LinkitConversationDisplay({ conversation, compact, className, ...props }: LinkitConversationDisplayProps): import("react").JSX.Element;
