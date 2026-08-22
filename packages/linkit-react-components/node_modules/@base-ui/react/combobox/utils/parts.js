"use strict";
'use client';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clickHighlightedItem = clickHighlightedItem;
exports.getChipNavigationKeys = getChipNavigationKeys;
exports.getIndexAfterChipRemoval = getIndexAfterChipRemoval;
exports.useListEmpty = useListEmpty;
exports.usePopupSide = usePopupSide;
var _store = require("@base-ui/utils/store");
var _ComboboxRootContext = require("../root/ComboboxRootContext");
var _store2 = require("../store");
/**
 * The popup side is only meaningful while the positioner is mounted, as the store retains the
 * last resolved side after the popup unmounts.
 */
function usePopupSide(store) {
  const mounted = (0, _store.useStore)(store, _store2.selectors.mounted);
  const popupSide = (0, _store.useStore)(store, _store2.selectors.popupSide);
  const positionerElement = (0, _store.useStore)(store, _store2.selectors.positionerElement);
  return mounted && positionerElement ? popupSide : null;
}

/**
 * Whether the filtered list has no items to show.
 */
function useListEmpty() {
  return (0, _ComboboxRootContext.useComboboxDerivedItemsContext)().filteredItems.length === 0;
}

/**
 * The arrow keys that move the chip highlight backwards and forwards, in that order.
 */
function getChipNavigationKeys(direction) {
  return direction === 'rtl' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
}

/**
 * Where the highlight lands once the chip at `index` is removed, or `undefined` for no highlight.
 */
function getIndexAfterChipRemoval(index, chipCount) {
  const nextIndex = index >= chipCount - 1 ? chipCount - 2 : index;
  return nextIndex >= 0 ? nextIndex : undefined;
}

/**
 * Commits the highlighted item by clicking it, tagging the originating event so the item's
 * handler can attribute the selection to it.
 */
function clickHighlightedItem(store, activeIndex, nativeEvent) {
  const listItem = store.state.listRef.current[activeIndex];
  if (listItem) {
    store.state.selectionEventRef.current = nativeEvent;
    listItem.click();
    store.state.selectionEventRef.current = null;
  }
}