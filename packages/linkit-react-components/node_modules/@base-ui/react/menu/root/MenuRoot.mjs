'use client';

import * as React from 'react';
import { useTimeout } from '@base-ui/utils/useTimeout';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useId } from '@base-ui/utils/useId';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useRefWithInit } from '@base-ui/utils/useRefWithInit';
import { EMPTY_ARRAY, EMPTY_OBJECT } from '@base-ui/utils/empty';
import { fastComponent } from '@base-ui/utils/fastHooks';
import { FloatingTree, useDismiss, useFloatingNodeId, useFloatingParentNodeId, useListNavigation, useTypeahead, useSyncedFloatingRootContext } from "../../floating-ui-react/index.mjs";
import { MenuRootContext, useMenuRootContext } from "./MenuRootContext.mjs";
import { useMenubarContext } from "../../menubar/MenubarContext.mjs";
import { TYPEAHEAD_RESET_MS } from "../../internals/constants.mjs";
import { useDirection } from "../../internals/direction-context/DirectionContext.mjs";
import { useOpenInteractionType } from "../../utils/useOpenInteractionType.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { useContextMenuRootContext } from "../../context-menu/root/ContextMenuRootContext.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { MenuStore } from "../store/MenuStore.mjs";
import { attachPreventUnmountOnClose, FOCUSABLE_POPUP_PROPS, setPopupOpenState, PopupHandleAttachment, useImplicitActiveTrigger, useOpenStateTransitions, usePopupInteractionProps } from "../../utils/popups/index.mjs";
import { useMenuSubmenuRootContext } from "../submenu-root/MenuSubmenuRootContext.mjs";

/**
 * Groups all parts of the menu.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Menu](https://base-ui.com/react/components/menu)
 */
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const MenuRoot = fastComponent(function MenuRoot(props) {
  const {
    children,
    open: openProp,
    onOpenChange,
    onOpenChangeComplete,
    defaultOpen = false,
    disabled: disabledProp = false,
    modal: modalProp,
    loopFocus = true,
    orientation = 'vertical',
    actionsRef,
    closeParentOnEsc = false,
    handle,
    triggerId: triggerIdProp,
    defaultTriggerId: defaultTriggerIdProp = null,
    highlightItemOnHover = true
  } = props;
  const contextMenuContext = useContextMenuRootContext(true);
  const parentMenuRootContext = useMenuRootContext(true);
  const menubarContext = useMenubarContext(true);
  const isSubmenu = useMenuSubmenuRootContext();
  const parentFromContext = React.useMemo(() => {
    if (isSubmenu && parentMenuRootContext) {
      return {
        type: 'menu',
        store: parentMenuRootContext.store
      };
    }
    if (menubarContext) {
      return {
        type: 'menubar',
        context: menubarContext
      };
    }

    // Ensure this is not a Menu nested inside ContextMenu.Trigger.
    // ContextMenu parentContext is always undefined as ContextMenu.Root is instantiated with
    // <MenuRootContext.Provider value={undefined}>
    if (contextMenuContext && !parentMenuRootContext) {
      return {
        type: 'context-menu',
        context: contextMenuContext
      };
    }
    return {
      type: undefined
    };
  }, [contextMenuContext, parentMenuRootContext, menubarContext, isSubmenu]);
  const store = useMenuRootStore({
    open: defaultOpen,
    openProp,
    activeTriggerId: defaultTriggerIdProp,
    triggerIdProp,
    parent: parentFromContext
  });
  store.useControlledProp('openProp', openProp);
  store.useControlledProp('triggerIdProp', triggerIdProp);
  store.useContextCallback('onOpenChangeComplete', onOpenChangeComplete);
  const rootId = useId();
  const floatingId = useId();
  const floatingTreeRoot = store.useState('floatingTreeRoot');
  const floatingNodeIdFromContext = useFloatingNodeId(floatingTreeRoot);
  const floatingParentNodeIdFromContext = useFloatingParentNodeId();
  const open = store.useState('open');
  const activeTriggerElement = store.useState('activeTriggerElement');
  const positionerElement = store.useState('positionerElement');
  const hoverEnabled = store.useState('hoverEnabled');
  const disabled = store.useState('disabled');
  const lastOpenChangeReason = store.useState('lastOpenChangeReason');
  const parent = store.useState('parent');
  const activeIndex = store.useState('activeIndex');
  const payload = store.useState('payload');
  const floatingParentNodeId = store.useState('floatingParentNodeId');
  const openEventRef = React.useRef(null);
  const allowOutsidePressDismissalRef = React.useRef(parent.type !== 'context-menu');
  const allowOutsidePressDismissalTimeout = useTimeout();
  const allowTouchToCloseRef = React.useRef(true);
  const allowTouchToCloseTimeout = useTimeout();
  const nested = floatingParentNodeId != null;
  if (process.env.NODE_ENV !== 'production') {
    if (parent.type !== undefined && modalProp !== undefined) {
      console.warn('Base UI: The `modal` prop is not supported on nested menus. It will be ignored.');
    }
  }
  const {
    openMethod,
    triggerProps: interactionTypeProps
  } = useOpenInteractionType(open);
  store.useSyncedValues({
    disabled: disabledProp,
    highlightItemOnHover,
    modal: parent.type === undefined ? modalProp : undefined,
    openMethod,
    rootId
  });
  useImplicitActiveTrigger(store);
  const {
    forceUnmount
  } = useOpenStateTransitions(open, store, () => {
    store.set('allowMouseEnter', false);
  });
  useIsoLayoutEffect(() => {
    if (contextMenuContext && !parentMenuRootContext) {
      // This is a context menu root.
      // It doesn't support detached triggers yet, so we have to sync the parent context manually.
      store.update({
        parent: {
          type: 'context-menu',
          context: contextMenuContext
        },
        floatingNodeId: floatingNodeIdFromContext,
        floatingParentNodeId: floatingParentNodeIdFromContext
      });
    } else if (parentMenuRootContext) {
      store.update({
        floatingNodeId: floatingNodeIdFromContext,
        floatingParentNodeId: floatingParentNodeIdFromContext
      });
    }
  }, [contextMenuContext, parentMenuRootContext, floatingNodeIdFromContext, floatingParentNodeIdFromContext, store]);
  React.useEffect(() => {
    if (!open) {
      openEventRef.current = null;
    }
    if (parent.type !== 'context-menu') {
      return;
    }
    if (!open) {
      allowOutsidePressDismissalTimeout.clear();
      allowOutsidePressDismissalRef.current = false;
      return;
    }

    // With `mousedown` outside press events and long press touch input, there
    // needs to be a grace period after opening to ensure the dismissal event
    // doesn't fire immediately after open.
    allowOutsidePressDismissalTimeout.start(500, () => {
      allowOutsidePressDismissalRef.current = true;
    });
  }, [allowOutsidePressDismissalTimeout, open, parent.type]);
  useIsoLayoutEffect(() => {
    if (!open && !hoverEnabled) {
      store.set('hoverEnabled', true);
    }
  }, [open, hoverEnabled, store]);
  const setOpen = useStableCallback((nextOpen, eventDetails) => {
    const reason = eventDetails.reason;

    // Read the store directly, as relayed tree events and stale hover timers can request
    // a close after the state changed but before this component re-rendered.
    if (!nextOpen && !store.select('open')) {
      return;
    }
    if (open === nextOpen && eventDetails.trigger === activeTriggerElement && lastOpenChangeReason === reason) {
      return;
    }
    const shouldPreventUnmountOnClose = attachPreventUnmountOnClose(eventDetails);

    // Do not immediately reset the activeTriggerId to allow
    // exit animations to play and focus to be returned correctly.
    if (!nextOpen && eventDetails.trigger == null) {
      eventDetails.trigger = activeTriggerElement ?? undefined;
    }
    onOpenChange?.(nextOpen, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    store.state.floatingRootContext.dispatchOpenChange(nextOpen, eventDetails);
    const nativeEvent = eventDetails.event;
    if (nextOpen === false && nativeEvent?.type === 'click' && nativeEvent.pointerType === 'touch' && !allowTouchToCloseRef.current) {
      return;
    }

    // Prevent the menu from closing on mobile devices that have a delayed click event.
    // In some cases the menu, when tapped, will fire the focus event first and then the click event.
    // Without this guard, the menu will close immediately after opening.
    if (nextOpen && reason === REASONS.triggerFocus) {
      allowTouchToCloseRef.current = false;
      allowTouchToCloseTimeout.start(300, () => {
        allowTouchToCloseRef.current = true;
      });
    } else {
      allowTouchToCloseRef.current = true;
      allowTouchToCloseTimeout.clear();
    }

    // Keyboard and assistive-technology activations produce `detail === 0` clicks;
    // mouse-gesture clicks (including the synthesized drag-release click from
    // `useMenuItemCommonProps`) carry `detail >= 1`.
    const isKeyboardClick = (reason === REASONS.triggerPress || reason === REASONS.itemPress) && nativeEvent.detail === 0;
    const isDismissClose = !nextOpen && (reason === REASONS.escapeKey || reason == null);
    const updatedState = {
      open: nextOpen,
      openChangeReason: reason
    };
    openEventRef.current = eventDetails.event;
    setPopupOpenState(updatedState, nextOpen, eventDetails.trigger, shouldPreventUnmountOnClose());
    store.update(updatedState);
    if (parent.type === 'menubar' && (reason === REASONS.triggerFocus || reason === REASONS.focusOut || reason === REASONS.triggerHover || reason === REASONS.listNavigation || reason === REASONS.siblingOpen)) {
      store.set('instantType', 'group');
    } else if (isKeyboardClick || isDismissClose) {
      store.set('instantType', isKeyboardClick ? 'click' : 'dismiss');
    } else {
      store.set('instantType', undefined);
    }
  });
  const floatingRootContext = useSyncedFloatingRootContext({
    popupStore: store,
    floatingId,
    nested: floatingParentNodeIdFromContext != null,
    onOpenChange: setOpen
  });
  const floatingEvents = floatingRootContext.context.events;

  // Registered in a layout effect (not a passive one) so `setOpen` emits from imperative
  // `MenuHandle.open()` calls made in the same commit this root mounts — e.g. from another layout
  // effect during a route-transition handoff — are received instead of being silently dropped.
  useIsoLayoutEffect(() => {
    const handleSetOpenEvent = ({
      open: nextOpen,
      eventDetails
    }) => setOpen(nextOpen, eventDetails);
    floatingEvents.on('setOpen', handleSetOpenEvent);
    return () => {
      floatingEvents?.off('setOpen', handleSetOpenEvent);
    };
  }, [floatingEvents, setOpen]);
  const handleImperativeClose = React.useCallback(() => {
    store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction));
  }, [store]);
  React.useImperativeHandle(actionsRef, () => ({
    unmount: forceUnmount,
    close: handleImperativeClose
  }), [forceUnmount, handleImperativeClose]);
  let ctx;
  if (parent.type === 'context-menu') {
    ctx = parent.context;
  }
  React.useImperativeHandle(ctx?.positionerRef, () => positionerElement, [positionerElement]);
  React.useImperativeHandle(ctx?.actionsRef, () => ({
    setOpen
  }), [setOpen]);
  const dismiss = useDismiss(floatingRootContext, {
    enabled: !disabled,
    bubbles: {
      escapeKey: closeParentOnEsc && parent.type === 'menu'
    },
    outsidePress() {
      if (parent.type !== 'context-menu' || openEventRef.current?.type === 'contextmenu') {
        return true;
      }
      return allowOutsidePressDismissalRef.current;
    },
    externalTree: nested ? floatingTreeRoot : undefined
  });
  const direction = useDirection();
  const setActiveIndex = React.useCallback(index => {
    if (store.select('activeIndex') === index) {
      return;
    }
    store.set('activeIndex', index);
  }, [store]);
  const listNavigation = useListNavigation(floatingRootContext, {
    enabled: !disabled,
    listRef: store.context.itemDomElements,
    activeIndex,
    nested: parent.type !== undefined,
    loopFocus,
    orientation,
    parentOrientation: parent.type === 'menubar' ? parent.context.orientation : undefined,
    rtl: direction === 'rtl',
    disabledIndices: EMPTY_ARRAY,
    onNavigate: setActiveIndex,
    openOnArrowKeyDown: parent.type !== 'context-menu',
    externalTree: nested ? floatingTreeRoot : undefined,
    focusItemOnHover: highlightItemOnHover
  });
  const onTyping = React.useCallback(nextTyping => {
    store.context.typingRef.current = nextTyping;
  }, [store]);
  const typeahead = useTypeahead(floatingRootContext, {
    enabled: !disabled,
    listRef: store.context.itemLabels,
    elementsRef: store.context.itemDomElements,
    activeIndex,
    resetMs: TYPEAHEAD_RESET_MS,
    onMatch: index => {
      if (open && index !== activeIndex) {
        store.set('activeIndex', index);
      }
    },
    onTyping
  });
  const activeTriggerProps = React.useMemo(() => {
    const mergedProps = mergeProps(typeahead.reference, listNavigation.reference, dismiss.reference, {
      onMouseMove() {
        store.set('allowMouseEnter', true);
      }
    }, interactionTypeProps);
    mergedProps['aria-haspopup'] = 'menu';
    mergedProps['aria-expanded'] = open;
    return mergedProps;
  }, [store, typeahead.reference, listNavigation.reference, dismiss.reference, interactionTypeProps, open]);
  const inactiveTriggerProps = React.useMemo(() => {
    const mergedProps = mergeProps(listNavigation.trigger, dismiss.trigger, interactionTypeProps);
    mergedProps['aria-haspopup'] = 'menu';
    mergedProps['aria-expanded'] = false;
    return mergedProps;
  }, [listNavigation.trigger, dismiss.trigger, interactionTypeProps]);
  const popupProps = React.useMemo(() => mergeProps(FOCUSABLE_POPUP_PROPS, {
    id: floatingId,
    role: 'menu',
    'aria-labelledby': activeTriggerElement?.id,
    onMouseMove() {
      store.set('allowMouseEnter', true);
      if (parent.type === 'menu') {
        store.set('hoverEnabled', false);
      }
    },
    onClick() {
      if (store.select('hoverEnabled')) {
        store.set('hoverEnabled', false);
      }
    },
    onKeyDown(event) {
      // The Menubar's CompositeRoot captures keyboard events via
      // event delegation. This works well when Menu.Root is nested inside Menubar,
      // but with detached triggers we need to manually forward the event to the CompositeRoot.
      const relay = store.select('keyboardEventRelay');
      if (relay && !event.isPropagationStopped()) {
        relay(event);
      }
    }
  }, typeahead.floating, listNavigation.floating, dismiss.floating), [activeTriggerElement, floatingId, parent.type, store, typeahead.floating, listNavigation.floating, dismiss.floating]);
  const itemProps = listNavigation.item ?? EMPTY_OBJECT;
  usePopupInteractionProps(store, {
    floatingRootContext,
    activeTriggerProps,
    inactiveTriggerProps,
    popupProps,
    itemProps
  });
  const context = React.useMemo(() => ({
    store,
    parent: parentFromContext
  }), [store, parentFromContext]);
  const content = /*#__PURE__*/_jsxs(MenuRootContext.Provider, {
    value: context,
    children: [handle && /*#__PURE__*/_jsx(PopupHandleAttachment, {
      handle: handle,
      store: store
    }), typeof children === 'function' ? children({
      payload
    }) : children]
  });
  if (parent.type === undefined || parent.type === 'context-menu') {
    // set up a FloatingTree to provide the context to nested menus
    return /*#__PURE__*/_jsx(FloatingTree, {
      externalTree: floatingTreeRoot,
      children: content
    });
  }
  return content;
});
if (process.env.NODE_ENV !== "production") MenuRoot.displayName = "MenuRoot";
function useMenuRootStore(initialState) {
  // The store is owned by this Root instance and created exactly once. It is not tied to the handle:
  // the handle attaches to it, so swapping the handle re-attaches rather than recreating state.
  // Default values are only initial values; controlled values and root state are synced after creation.
  // Unlike other popups, Menu wires its floating root context separately (it relays open changes
  // through an event).
  const store = useRefWithInit(() => new MenuStore(initialState)).current;
  return store;
}