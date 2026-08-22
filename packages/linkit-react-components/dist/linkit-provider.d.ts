import { type ReactNode } from "react";
import type { LinkitMe, LinkitProfile } from "./types.js";
export type LinkitProviderProps = {
    linkitBaseUrl: string;
    children: ReactNode;
};
export type LinkitContextValue = {
    linkitBaseUrl: string;
    request: <T>(path: string, init?: RequestInit) => Promise<T>;
    getMe: () => Promise<LinkitMe>;
    getProfile: (userId: string) => Promise<LinkitProfile>;
};
export declare function LinkitProvider({ linkitBaseUrl, children }: LinkitProviderProps): import("react").JSX.Element;
export declare function useLinkit(): LinkitContextValue;
