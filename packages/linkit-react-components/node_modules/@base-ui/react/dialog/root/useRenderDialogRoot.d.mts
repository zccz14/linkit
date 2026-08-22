import type { DialogRootProps } from "./DialogRoot.mjs";
export declare function useRenderDialogRoot<Payload>(mode: DialogRootMode, props: DialogRootProps<Payload>): import("react/jsx-runtime").JSX.Element;
type DialogRootMode = 'dialog' | 'drawer' | 'alert-dialog';
export {};