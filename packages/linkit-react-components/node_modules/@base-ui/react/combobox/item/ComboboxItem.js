"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ComboboxItem = void 0;
var React = _interopRequireWildcard(require("react"));
var ReactDOM = _interopRequireWildcard(require("react-dom"));
var _store = require("@base-ui/utils/store");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _ComboboxRootContext = require("../root/ComboboxRootContext");
var _useCompositeListItem = require("../../internals/composite/list/useCompositeListItem");
var _useRenderElement = require("../../internals/useRenderElement");
var _ComboboxItemContext = require("./ComboboxItemContext");
var _store2 = require("../store");
var _useButton = require("../../internals/use-button");
var _ComboboxRowContext = require("../row/ComboboxRowContext");
var _itemEquality = require("../../internals/itemEquality");
var _jsxRuntime = require("react/jsx-runtime");
function ComboboxItemInner(props) {
  const {
    componentProps,
    forwardedRef,
    virtualized,
    indexFromFilter
  } = props;
  const {
    render,
    className,
    style,
    value: itemValue = null,
    index: indexProp,
    disabled: disabledProp = false,
    nativeButton = false,
    ...elementProps
  } = componentProps;
  const textRef = React.useRef(null);
  const listItem = (0, _useCompositeListItem.useCompositeListItem)({
    guess: true,
    index: indexProp,
    textRef
  });
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const isRow = (0, _ComboboxRowContext.useComboboxRowContext)();
  const hasItems = (0, _ComboboxRootContext.useComboboxHasItemsContext)();
  const selectionMode = (0, _store.useStore)(store, _store2.selectors.selectionMode);
  const rootDisabled = (0, _store.useStore)(store, _store2.selectors.disabled);
  const readOnly = (0, _store.useStore)(store, _store2.selectors.readOnly);
  const isItemEqualToValue = (0, _store.useStore)(store, _store2.selectors.isItemEqualToValue);
  const disabled = rootDisabled || disabledProp;
  const selectable = selectionMode !== 'none';
  const index = indexProp ?? indexFromFilter ?? listItem.index;
  const hasRegistered = index !== -1;
  const rootId = (0, _store.useStore)(store, _store2.selectors.id);
  const highlighted = (0, _store.useStore)(store, _store2.selectors.isActive, index);
  const matchesSelectedValue = (0, _store.useStore)(store, _store2.selectors.isSelected, itemValue);
  const itemProps = (0, _store.useStore)(store, _store2.selectors.itemProps);
  const itemRef = React.useRef(null);
  const id = rootId != null && hasRegistered ? `${rootId}-${index}` : undefined;
  const selected = matchesSelectedValue && selectable;
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const shouldRun = hasRegistered && (virtualized || indexProp != null);
    if (!shouldRun) {
      return undefined;
    }
    const list = store.state.listRef.current;
    list[index] = itemRef.current;
    return () => {
      delete list[index];
    };
  }, [hasRegistered, virtualized, index, indexProp, store]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!hasRegistered || hasItems) {
      return undefined;
    }
    const visibleMap = store.state.valuesRef.current;
    visibleMap[index] = itemValue;
    return () => {
      delete visibleMap[index];
    };
  }, [hasRegistered, hasItems, index, itemValue, store]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!hasRegistered || hasItems) {
      return;
    }

    // Runs while closed as well (the list can stay mounted via `keepMounted` or a
    // force-mount) so the index tracks the item's composite position, keeping features
    // like closed-trigger typeahead in sync when the rendered order changes.
    const selectedValue = store.state.selectedValue;
    const lastSelectedValue = Array.isArray(selectedValue) ? selectedValue[selectedValue.length - 1] : selectedValue;
    if ((0, _itemEquality.compareItemEquality)(itemValue, lastSelectedValue, isItemEqualToValue)) {
      store.set('selectedIndex', index);
    }
  }, [hasRegistered, hasItems, store, index, itemValue, isItemEqualToValue]);
  const {
    getButtonProps,
    buttonRef
  } = (0, _useButton.useButton)({
    disabled,
    focusableWhenDisabled: true,
    native: nativeButton,
    composite: true
  });
  const state = {
    disabled,
    selected,
    highlighted
  };
  function commitSelection(nativeEvent) {
    function selectItem() {
      store.state.handleSelection(nativeEvent, itemValue);
    }
    if (store.state.submitOnItemClick) {
      ReactDOM.flushSync(selectItem);
      store.state.requestSubmit();
    } else {
      selectItem();
    }
  }
  const defaultProps = {
    id,
    role: isRow ? 'gridcell' : 'option',
    'aria-selected': selectable ? selected : undefined,
    // Focusable items steal focus from the input upon mouseup.
    // Warn if the user renders a natively focusable element like `<button>`,
    // as it should be a `<div>` instead.
    tabIndex: undefined,
    onPointerDownCapture(event) {
      // The compat `mouseup` only fires for the primary pointer, so a non-primary
      // touch must not overwrite the shared ref — a mismatch would make the primary
      // pointer's release read as a drag-select and commit a second time after `click`.
      if (event.isPrimary) {
        store.state.pointerDownItemRef.current = event.currentTarget;
      }
      event.preventDefault();
    },
    onMouseDown(event) {
      // iOS Safari can emit a synthetic mousedown for touch taps without a preceding
      // pointerdown. Prevent default here too so tapping an item does not blur the input.
      event.preventDefault();
    },
    onClick(event) {
      if (disabled || readOnly) {
        return;
      }
      commitSelection(event.nativeEvent);
    },
    onMouseUp(event) {
      const pointerStartedOnItem = store.state.pointerDownItemRef.current === event.currentTarget;
      store.state.pointerDownItemRef.current = null;
      if (disabled || readOnly || event.button !== 0 || pointerStartedOnItem || !highlighted) {
        return;
      }
      commitSelection(event.nativeEvent);
    }
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [buttonRef, forwardedRef, listItem.ref, itemRef],
    state,
    props: [itemProps, defaultProps, elementProps, getButtonProps]
  });
  const contextValue = React.useMemo(() => ({
    selected,
    textRef
  }), [selected, textRef]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_ComboboxItemContext.ComboboxItemContext.Provider, {
    value: contextValue,
    children: element
  });
}

/**
 * Resolves the index from the filtered items for the virtualized fallback (no `index` prop).
 * Isolated here so that this per-keystroke subscription to the derived-items context is only
 * paid by virtualized items. Those re-render on every input change anyway — the parent
 * virtualizer re-windows the list as the filtered set changes — so the extra subscription costs
 * them nothing, while it keeps every non-virtualized item off that context.
 */
function ComboboxItemVirtualizedIndex(props) {
  const {
    componentProps,
    forwardedRef
  } = props;
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const isItemEqualToValue = (0, _store.useStore)(store, _store2.selectors.isItemEqualToValue);
  const {
    flatFilteredItems
  } = (0, _ComboboxRootContext.useComboboxDerivedItemsContext)();
  const indexFromFilter = (0, _itemEquality.findItemIndex)(flatFilteredItems, componentProps.value ?? null, isItemEqualToValue);

  // Only reached when `virtualized` is true (see the wrapper below).
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(ComboboxItemInner, {
    componentProps: componentProps,
    forwardedRef: forwardedRef,
    virtualized: true,
    indexFromFilter: indexFromFilter
  });
}

/**
 * An individual item in the list.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
const ComboboxItem = exports.ComboboxItem = /*#__PURE__*/React.memo(/*#__PURE__*/React.forwardRef(function ComboboxItem(componentProps, forwardedRef) {
  const store = (0, _ComboboxRootContext.useComboboxRootContext)();
  const virtualized = (0, _store.useStore)(store, _store2.selectors.virtualized);

  // `virtualized` (and whether an item provides an explicit `index`) must be stable for an
  // item's lifetime: the two branches return different component types, so flipping it at
  // runtime remounts the item and resets its refs and effects.
  if (virtualized && componentProps.index == null) {
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(ComboboxItemVirtualizedIndex, {
      componentProps: componentProps,
      forwardedRef: forwardedRef
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(ComboboxItemInner, {
    componentProps: componentProps,
    forwardedRef: forwardedRef,
    virtualized: virtualized,
    indexFromFilter: undefined
  });
}));
if (process.env.NODE_ENV !== "production") ComboboxItem.displayName = "ComboboxItem";