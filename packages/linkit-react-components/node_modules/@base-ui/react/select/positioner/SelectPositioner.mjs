'use client';

import * as React from 'react';
import { inertValue } from '@base-ui/utils/inertValue';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useStore } from '@base-ui/utils/store';
import { useSelectRootContext } from "../root/SelectRootContext.mjs";
import { CompositeList } from "../../internals/composite/list/CompositeList.mjs";
import { useAnchorPositioning } from "../../internals/useAnchorPositioning.mjs";
import { SelectPositionerContext } from "./SelectPositionerContext.mjs";
import { InternalBackdrop } from "../../utils/InternalBackdrop.mjs";
import { DROPDOWN_COLLISION_AVOIDANCE } from "../../internals/constants.mjs";
import { clearStyles } from "../popup/utils.mjs";
import { selectors } from "../store.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { findItemIndex } from "../../internals/itemEquality.mjs";
import { usePositioner } from "../../utils/usePositioner.mjs";
import { useAnchoredPopupScrollLock } from "../../utils/useAnchoredPopupScrollLock.mjs";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const FIXED = {
  position: 'fixed'
};

/**
 * Positions the select popup.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Select](https://base-ui.com/react/components/select)
 */
export const SelectPositioner = /*#__PURE__*/React.forwardRef(function SelectPositioner(componentProps, forwardedRef) {
  const {
    anchor,
    className,
    render,
    // `useAnchorPositioning` applies the same defaults to the undefined values; the names
    // remain destructured to exclude the props from `elementProps`.
    positionMethod,
    side,
    align,
    sideOffset,
    alignOffset,
    collisionBoundary = 'clipping-ancestors',
    collisionPadding,
    arrowPadding,
    sticky,
    disableAnchorTracking,
    alignItemWithTrigger = true,
    collisionAvoidance = DROPDOWN_COLLISION_AVOIDANCE,
    style,
    ...elementProps
  } = componentProps;
  const {
    store,
    listRef,
    labelsRef,
    alignItemWithTriggerActiveRef,
    selectedItemTextRef,
    valuesRef,
    initialValueRef,
    popupRef,
    setValue,
    floatingContext: floatingRootContext
  } = useSelectRootContext();
  const open = useStore(store, selectors.open);
  const mounted = useStore(store, selectors.mounted);
  const modal = useStore(store, selectors.modal);
  const value = useStore(store, selectors.value);
  const openMethod = useStore(store, selectors.openMethod);
  const positionerElement = useStore(store, selectors.positionerElement);
  const triggerElement = useStore(store, selectors.triggerElement);
  const isItemEqualToValue = useStore(store, selectors.isItemEqualToValue);
  const transitionStatus = useStore(store, selectors.transitionStatus);
  const scrollUpArrowRef = React.useRef(null);
  const scrollDownArrowRef = React.useRef(null);
  const [controlledAlignItemWithTrigger, setControlledAlignItemWithTrigger] = React.useState(alignItemWithTrigger);
  const alignItemWithTriggerActive = mounted && controlledAlignItemWithTrigger && openMethod !== 'touch';
  if (!mounted && controlledAlignItemWithTrigger !== alignItemWithTrigger) {
    setControlledAlignItemWithTrigger(alignItemWithTrigger);
  }
  React.useImperativeHandle(alignItemWithTriggerActiveRef, () => alignItemWithTriggerActive);
  useAnchoredPopupScrollLock((alignItemWithTriggerActive || modal) && open, openMethod === 'touch', positionerElement, triggerElement);
  const positioning = useAnchorPositioning({
    anchor,
    floatingRootContext,
    positionMethod,
    mounted,
    side,
    sideOffset,
    align,
    alignOffset,
    arrowPadding,
    collisionBoundary,
    collisionPadding,
    sticky,
    disableAnchorTracking: disableAnchorTracking ?? alignItemWithTriggerActive,
    collisionAvoidance,
    keepMounted: true
  });
  const renderedSide = alignItemWithTriggerActive ? 'none' : positioning.side;
  const positionerStyles = alignItemWithTriggerActive ? FIXED : positioning.positionerStyles;
  const state = {
    open,
    side: renderedSide,
    align: positioning.align,
    anchorHidden: positioning.anchorHidden
  };
  useIsoLayoutEffect(() => {
    store.set('popupSide', positioning.side);
  }, [store, positioning.side]);
  const setPositionerElement = store.useStateSetter('positionerElement');
  const element = usePositioner(componentProps, state, {
    styles: positionerStyles,
    transitionStatus,
    props: elementProps,
    refs: [forwardedRef, setPositionerElement],
    hidden: !mounted,
    inert: !open
  });
  const prevMapSizeRef = React.useRef(0);
  const onMapChange = useStableCallback(map => {
    if (valuesRef.current.length === 0) {
      return;
    }
    const prevSize = prevMapSizeRef.current;
    prevMapSizeRef.current = map.size;
    if (map.size === prevSize) {
      return;
    }
    const eventDetails = createChangeEventDetails(REASONS.none);
    if (prevSize !== 0 && !store.state.multiple && value !== null) {
      const selectedValueIndex = findItemIndex(valuesRef.current, value, isItemEqualToValue);
      if (selectedValueIndex === -1) {
        const initialSelectedValue = initialValueRef.current;
        const hasInitial = initialSelectedValue != null && findItemIndex(valuesRef.current, initialSelectedValue, isItemEqualToValue) !== -1;
        const nextValue = hasInitial ? initialSelectedValue : null;
        setValue(nextValue, eventDetails);
        if (nextValue === null) {
          store.set('selectedIndex', null);
          selectedItemTextRef.current = null;
        }
      }
    }
    if (prevSize !== 0 && store.state.multiple && Array.isArray(value)) {
      const nextValue = value.filter(selectedItemValue => findItemIndex(valuesRef.current, selectedItemValue, isItemEqualToValue) !== -1);
      if (nextValue.length !== value.length) {
        setValue(nextValue, eventDetails);
        if (nextValue.length === 0) {
          store.set('selectedIndex', null);
          selectedItemTextRef.current = null;
        }
      }
    }
    if (open && alignItemWithTriggerActive) {
      store.update({
        scrollUpArrowVisible: false,
        scrollDownArrowVisible: false
      });
      const stylesToClear = {
        height: ''
      };
      clearStyles(positionerElement, stylesToClear);
      clearStyles(popupRef.current, stylesToClear);
    }
  });
  const contextValue = React.useMemo(() => ({
    ...positioning,
    side: renderedSide,
    alignItemWithTriggerActive,
    setControlledAlignItemWithTrigger,
    scrollUpArrowRef,
    scrollDownArrowRef
  }), [positioning, renderedSide, alignItemWithTriggerActive, setControlledAlignItemWithTrigger]);
  return /*#__PURE__*/_jsx(CompositeList, {
    elementsRef: listRef,
    labelsRef: labelsRef,
    onMapChange: onMapChange,
    children: /*#__PURE__*/_jsxs(SelectPositionerContext.Provider, {
      value: contextValue,
      children: [mounted && modal && /*#__PURE__*/_jsx(InternalBackdrop, {
        inert: inertValue(!open),
        cutout: triggerElement
      }), element]
    })
  });
});
if (process.env.NODE_ENV !== "production") SelectPositioner.displayName = "SelectPositioner";