'use client';

import { useRenderDialogRoot } from "./useRenderDialogRoot.mjs";

/**
 * Groups all parts of the dialog.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Dialog](https://base-ui.com/react/components/dialog)
 */
export function DialogRoot(props) {
  return useRenderDialogRoot('dialog', props);
}