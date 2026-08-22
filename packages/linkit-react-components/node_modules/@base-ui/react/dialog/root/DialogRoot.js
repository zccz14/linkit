"use strict";
'use client';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DialogRoot = DialogRoot;
var _useRenderDialogRoot = require("./useRenderDialogRoot");
/**
 * Groups all parts of the dialog.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Dialog](https://base-ui.com/react/components/dialog)
 */
function DialogRoot(props) {
  return (0, _useRenderDialogRoot.useRenderDialogRoot)('dialog', props);
}