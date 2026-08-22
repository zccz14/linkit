export type LinkitProfile = {
    user_id: string;
    username: string;
    display_name: string;
    avatar_url?: string | null;
    motto?: string | null;
};
export type LinkitConversation = {
    id: string;
    kind: "direct" | "group";
    title?: string | null;
    avatar_url?: string | null;
    counterpart?: LinkitProfile | null;
};
export type LinkitMe = {
    id: string;
    root: boolean;
    profile?: LinkitProfile | null;
};
