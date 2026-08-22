"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FOCUSABLE_POPUP_PROPS = void 0;
exports.PopupHandleAttachment = PopupHandleAttachment;
exports.applyPopupOpenChange = applyPopupOpenChange;
exports.attachPreventUnmountOnClose = attachPreventUnmountOnClose;
exports.createDefaultInitialFocus = createDefaultInitialFocus;
exports.setPopupOpenState = setPopupOpenState;
exports.useImplicitActiveTrigger = useImplicitActiveTrigger;
exports.useOpenStateTransitions = useOpenStateTransitions;
exports.usePopupInteractionProps = usePopupInteractionProps;
exports.usePopupRootStore = usePopupRootStore;
exports.usePopupRootSync = usePopupRootSync;
exports.useTriggerDataForwarding = useTriggerDataForwarding;
exports.useTriggerRegistration = useTriggerRegistration;
var React = _interopRequireWildcard(require("react"));
var ReactDOM = _interopRequireWildcard(require("react-dom"));
var _empty = require("@base-ui/utils/empty");
var _useId = require("@base-ui/utils/useId");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useRefWithInit = require("@base-ui/utils/useRefWithInit");
var _constants = require("../../floating-ui-react/utils/constants");
var _FloatingTree = require("../../floating-ui-react/components/FloatingTree");
var _useSyncedFloatingRootContext = require("../../floating-ui-react/hooks/useSyncedFloatingRootContext");
var _useTransitionStatus = require("../../internals/useTransitionStatus");
var _useOpenChangeComplete = require("../../internals/useOpenChangeComplete");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
const FOCUSABLE_POPUP_PROPS = exports.FOCUSABLE_POPUP_PROPS = {
  tabIndex: -1,
  [_constants.FOCUSABLE_ATTRIBUTE]: ''
};

/**
 * Returns the default `initialFocus` resolver for a popup. When opened by touch it focuses the
 * popup element itself to prevent the virtual keyboard from opening (required for Android
 * specifically; iOS handles this automatically). Otherwise it falls back to the default behavior.
 */
function createDefaultInitialFocus(popupRef) {
  return interactionType => interactionType === 'touch' ? popupRef.current : true;
}

/**
 * The subset of a popup handle that a Root needs to bind its store to. Both the real handle classes
 * and any test double satisfy it.
 */

/**
 * Creates and owns a popup store on behalf of a Root part. The store is created exactly once, with
 * controlled props and root state synced separately after creation. Sets up the synced floating
 * root context and returns the store.
 *
 * @param createStore Factory that builds the store. Called exactly once, receiving the floating id
 * and whether the popup is nested inside another floating element, both resolved on the first render.
 * @param treatPopupAsFloatingElement Whether the popup element is passed to Floating UI as the
 * floating element instead of the default positioner.
 */
function usePopupRootStore(createStore, treatPopupAsFloatingElement = false) {
  const floatingId = (0, _useId.useId)();
  const nested = (0, _FloatingTree.useFloatingParentNodeId)() != null;
  const store = (0, _useRefWithInit.useRefWithInit)(() => createStore(floatingId, nested)).current;
  (0, _useSyncedFloatingRootContext.useSyncedFloatingRootContext)({
    popupStore: store,
    treatPopupAsFloatingElement,
    floatingRootContext: store.state.floatingRootContext,
    floatingId,
    nested,
    onOpenChange: store.setOpen
  });
  return store;
}

/**
 * Attaches a Root's store to a handle for this component's committed lifetime. Popup Roots render
 * it before their interactions and user children so its layout effect runs before descendant layout
 * effects. This lets descendants call the handle during the Root's initial commit without attaching
 * during render, which would leak suspended or abandoned stores. Store subscribers are notified by
 * `attachStore` in this ordinary layout phase, where React permits synchronous updates.
 *
 * Popup Roots must render this component only when a handle is present so handle-less Roots avoid
 * mounting an extra fiber and layout effect.
 */
function PopupHandleAttachment({
  handle,
  store
}) {
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    return handle.attachStore(store);
  }, [handle, store]);
  return null;
}

/**
 * Returns a callback ref that registers/unregisters the trigger element in the store.
 *
 * @param store The Store instance where the trigger should be registered.
 */
function useTriggerRegistration(id, store) {
  // Keep track of the currently registered element to unregister it on unmount or id change.
  const registeredElementIdRef = React.useRef(null);
  const registeredElementRef = React.useRef(null);
  return React.useCallback(element => {
    if (id === undefined) {
      return;
    }
    let shouldSyncTriggerCount = false;
    if (registeredElementIdRef.current !== null) {
      const registeredId = registeredElementIdRef.current;
      const registeredElement = registeredElementRef.current;
      const currentElement = store.context.triggerElements.getById(registeredId);
      if (registeredElement && currentElement === registeredElement) {
        store.context.triggerElements.delete(registeredId);
        shouldSyncTriggerCount = true;
      }
      registeredElementIdRef.current = null;
      registeredElementRef.current = null;
    }
    if (element !== null) {
      registeredElementIdRef.current = id;
      registeredElementRef.current = element;
      store.context.triggerElements.add(id, element);
      shouldSyncTriggerCount = true;
    }
    if (shouldSyncTriggerCount) {
      const triggerCount = store.context.triggerElements.size;
      if (store.select('open') && store.state.triggerCount !== triggerCount) {
        store.set('triggerCount', triggerCount);
      }
    }
  }, [store, id]);
}
function setPopupOpenState(state, open, trigger, preventUnmountOnClose = false) {
  if (open) {
    // Opening starts a new close cycle, so clear any previous request to keep the popup mounted.
    state.preventUnmountingOnClose = false;
  } else if (preventUnmountOnClose) {
    state.preventUnmountingOnClose = true;
  }
  const triggerId = trigger?.id ?? null;

  // If a popup is closing, the `trigger` may be undefined.
  // We want to keep the previous value so that exit animations are played and focus is returned correctly.
  if (triggerId || open) {
    state.activeTriggerId = triggerId;
    state.activeTriggerElement = trigger ?? null;
  }
}
function attachPreventUnmountOnClose(eventDetails) {
  let preventUnmountOnClose = false;
  eventDetails.preventUnmountOnClose = () => {
    preventUnmountOnClose = true;
  };
  return () => preventUnmountOnClose;
}

/**
 * Runs the shared open-change sequence for a popup store: notifies `onOpenChange`,
 * honors cancellation, dispatches the floating root change, maps the reason to an
 * `instantType`, and commits the state update (synchronously for hover so
 * `getAnimations()` observes it). Stores supply their own differences via
 * `extraState` (e.g. the last change reason) and `onBeforeDispatch` (e.g. updating
 * inline-rect coordinates).
 */
function applyPopupOpenChange(store, nextOpen, eventDetails, options = {}) {
  const reason = eventDetails.reason;
  const isHover = reason === _reasons.REASONS.triggerHover;
  const isFocusOpen = nextOpen && reason === _reasons.REASONS.triggerFocus;
  const isDismissClose = !nextOpen && (reason === _reasons.REASONS.triggerPress || reason === _reasons.REASONS.escapeKey);
  const shouldPreventUnmountOnClose = attachPreventUnmountOnClose(eventDetails);
  store.context.onOpenChange?.(nextOpen, eventDetails);
  if (eventDetails.isCanceled) {
    return;
  }
  options.onBeforeDispatch?.();
  store.state.floatingRootContext.dispatchOpenChange(nextOpen, eventDetails);
  const changeState = () => {
    // Spread `extraState` first so `open` always reflects `nextOpen`, keeping it in
    // sync with the value already passed to `dispatchOpenChange`/`setPopupOpenState`.
    const updatedState = {
      ...options.extraState,
      open: nextOpen
    };
    if (isFocusOpen) {
      updatedState.instantType = 'focus';
    } else if (isDismissClose) {
      updatedState.instantType = 'dismiss';
    } else if (isHover) {
      updatedState.instantType = undefined;
    }
    setPopupOpenState(updatedState, nextOpen, eventDetails.trigger, shouldPreventUnmountOnClose());
    store.update(updatedState);
  };
  if (isHover) {
    // Flush synchronously for hover so `node.getAnimations()` sees the new state.
    ReactDOM.flushSync(changeState);
  } else {
    changeState();
  }
}

/**
 * Sets up trigger data forwarding to the store.
 *
 * @param triggerId Id of the trigger.
 * @param triggerElementRef Ref for the trigger DOM element.
 * @param store The Store instance managing the popup state.
 * @param stateUpdates An object with state updates to apply when the trigger is active.
 */
function useTriggerDataForwarding(triggerId, triggerElementRef, store, stateUpdates) {
  const isMountedByThisTrigger = store.useState('isMountedByTrigger', triggerId);
  const baseRegisterTrigger = useTriggerRegistration(triggerId, store);

  // Applies trigger-owned state (active-trigger ownership and payload) when the trigger registers.
  // Stable so payload/`stateUpdates` changes do not change the ref identity (which would needlessly
  // churn registration); it reads the latest closure values when invoked.
  const applyTriggerData = (0, _useStableCallback.useStableCallback)(element => {
    const open = store.select('open');
    const activeTriggerId = store.select('activeTriggerId');
    if (activeTriggerId === triggerId) {
      store.update({
        activeTriggerElement: element,
        ...(open ? stateUpdates : null)
      });
      return;
    }
    if (activeTriggerId == null && open) {
      // If a popup is already open, a detached trigger can mount before any active trigger
      // has been established. Claim the first registered trigger so trigger-owned focus
      // management and ARIA relationships work.
      store.update({
        activeTriggerId: triggerId,
        activeTriggerElement: element,
        ...stateUpdates
      });
    }
  });

  // Intentionally NOT stable. Its identity is derived from `baseRegisterTrigger`, which is keyed on
  // `[store, id]`, so when a handle-backed trigger's store pointer swaps the merged ref re-fires —
  // unregistering from the previous store and registering into the new one. This lets a detached
  // trigger follow its handle's currently-attached store across attach/detach/remount. (A stable
  // callback would keep its identity and never re-fire on a store swap.)
  const registerTrigger = React.useCallback(element => {
    baseRegisterTrigger(element);
    if (element) {
      applyTriggerData(element);
    }
  }, [baseRegisterTrigger, applyTriggerData]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (isMountedByThisTrigger) {
      store.update({
        activeTriggerElement: triggerElementRef.current,
        ...stateUpdates
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMountedByThisTrigger, store, triggerElementRef, ...Object.values(stateUpdates)]);
  return {
    registerTrigger,
    isMountedByThisTrigger
  };
}
/**
 * Keeps trigger registration state synchronized while the popup is open.
 *
 * When a popup opens without an explicit trigger id and exactly one trigger is registered, that
 * trigger is claimed as the active trigger. When the active trigger id is still registered but its
 * element changed, the active element is refreshed. When the active trigger id is missing from the
 * registry but the same element is still registered under a different id (e.g. the rendered trigger
 * carries its own DOM `id` that differs from Base UI's internal trigger id), the active id is
 * reassociated to the registered id instead of being treated as lost. When the active trigger
 * unregisters, the default path preserves existing ownership so non-closing popup families do not
 * silently claim a different trigger while staying open.
 *
 * If `closeOnActiveTriggerUnmount` is enabled, unregistering a previously resolved active trigger
 * requests a close after a microtask so a same-tick replacement trigger with the same id can
 * register first. An active trigger id that has not matched a registered trigger yet is treated as
 * pending and does not request a close.
 *
 * This should be called on the Root part.
 *
 * @param store The Store instance managing the popup state.
 * @param options Options for active trigger unmount behavior.
 */
function useImplicitActiveTrigger(store, options = {}) {
  const {
    closeOnActiveTriggerUnmount = false
  } = options;
  // Distinguishes a trigger that unmounted from a new active trigger that has not hydrated yet.
  const resolvedActiveTriggerIdRef = React.useRef(null);
  const open = store.useState('open');
  const reactiveTriggerCount = store.useState('triggerCount');
  // Subscribe to the active trigger id so the reconciliation below reruns when ownership moves to
  // another trigger while the popup stays open (e.g. a focus/hover handoff between triggers).
  const activeTriggerId = store.useState('activeTriggerId');
  // Subscribe to the active trigger element so the reconciliation reruns when a pending active
  // trigger registers in a commit where the trigger count nets out unchanged (registration
  // forwards the element to the store when the registering trigger matches the active id).
  // Without this, the id would never be marked resolved and a later genuine unmount would be
  // misclassified as pending, disabling `closeOnActiveTriggerUnmount`.
  const reactiveActiveTriggerElement = store.useState('activeTriggerElement');
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!open) {
      resolvedActiveTriggerIdRef.current = null;
      if (store.state.triggerCount !== 0) {
        store.set('triggerCount', 0);
      }
      return;
    }
    const triggerCount = store.context.triggerElements.size;
    const stateUpdates = {};
    if (store.state.triggerCount !== triggerCount) {
      stateUpdates.triggerCount = triggerCount;
    }
    const currentActiveTriggerId = store.select('activeTriggerId');
    let lostActiveTriggerId = null;
    if (currentActiveTriggerId) {
      const activeTriggerElement = store.context.triggerElements.getById(currentActiveTriggerId);
      if (!activeTriggerElement) {
        for (const [triggerId, triggerElement] of store.context.triggerElements.entries()) {
          if (triggerElement === store.state.activeTriggerElement) {
            stateUpdates.activeTriggerId = triggerId;
            stateUpdates.activeTriggerElement = triggerElement;
            resolvedActiveTriggerIdRef.current = triggerId;
            break;
          }
        }
        if (stateUpdates.activeTriggerId === undefined) {
          if (resolvedActiveTriggerIdRef.current === currentActiveTriggerId) {
            lostActiveTriggerId = currentActiveTriggerId;
          } else {
            resolvedActiveTriggerIdRef.current = null;
          }
        }
      } else {
        resolvedActiveTriggerIdRef.current = currentActiveTriggerId;
        if (activeTriggerElement !== store.state.activeTriggerElement) {
          stateUpdates.activeTriggerElement = activeTriggerElement;
        }
      }
    } else {
      resolvedActiveTriggerIdRef.current = null;
    }
    if (!lostActiveTriggerId && !currentActiveTriggerId && triggerCount === 1) {
      const iteratorResult = store.context.triggerElements.entries().next();
      if (!iteratorResult.done) {
        const [implicitTriggerId, implicitTriggerElement] = iteratorResult.value;
        stateUpdates.activeTriggerId = implicitTriggerId;
        stateUpdates.activeTriggerElement = implicitTriggerElement;
        resolvedActiveTriggerIdRef.current = implicitTriggerId;
      }
    }
    if (stateUpdates.triggerCount !== undefined || stateUpdates.activeTriggerId !== undefined || stateUpdates.activeTriggerElement !== undefined) {
      store.update(stateUpdates);
    }
    if (lostActiveTriggerId) {
      if (closeOnActiveTriggerUnmount) {
        // Defer so a same-tick replacement trigger with the same id can register first.
        queueMicrotask(() => {
          if (store.select('open') && store.select('activeTriggerId') === lostActiveTriggerId && !store.context.triggerElements.getById(lostActiveTriggerId)) {
            const eventDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none);
            store.setOpen(false, eventDetails);
            // If closing is canceled, keep the previous active trigger ownership for the
            // still-open popup instead of claiming another trigger implicitly.
            if (!eventDetails.isCanceled) {
              store.update({
                activeTriggerId: null,
                activeTriggerElement: null
              });
            }
          }
        });
      }
    }
  }, [open, store, reactiveTriggerCount, activeTriggerId, reactiveActiveTriggerElement, closeOnActiveTriggerUnmount]);
}

/**
 * Manages the mounted state of the popup.
 * Sets up the transition status listeners and handles unmounting when needed.
 * Updates the `mounted`, `transitionStatus`, and `preventUnmountingOnClose` states in the store.
 *
 * @param open Whether the popup is open.
 * @param store The Store instance managing the popup state.
 * @param onUnmount Optional callback to be called when the popup is unmounted.
 *
 * @returns A function to forcibly unmount the popup.
 */
function useOpenStateTransitions(open, store, onUnmount) {
  const {
    mounted,
    setMounted,
    transitionStatus
  } = (0, _useTransitionStatus.useTransitionStatus)(open);
  const preventUnmountingOnClose = store.useState('preventUnmountingOnClose');
  // Opening starts a new close cycle. Clear during render so the close-completion hook below
  // reads the synchronized value on the same pass.
  const syncedPreventUnmountingOnClose = open ? false : preventUnmountingOnClose;
  store.useSyncedValues({
    mounted,
    transitionStatus,
    preventUnmountingOnClose: syncedPreventUnmountingOnClose
  });
  const forceUnmount = (0, _useStableCallback.useStableCallback)(() => {
    setMounted(false);
    store.update({
      activeTriggerId: null,
      activeTriggerElement: null,
      mounted: false,
      preventUnmountingOnClose: false
    });
    onUnmount?.();
    store.context.onOpenChangeComplete?.(false);
  });
  (0, _useOpenChangeComplete.useOpenChangeComplete)({
    enabled: mounted && !open && !syncedPreventUnmountingOnClose,
    open,
    ref: store.context.popupRef,
    onComplete() {
      if (!open) {
        forceUnmount();
      }
    }
  });
  return {
    forceUnmount,
    transitionStatus
  };
}
function usePopupInteractionProps(store, statePart) {
  store.useSyncedValues(statePart);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => () => {
    store.update({
      activeTriggerProps: _empty.EMPTY_OBJECT,
      inactiveTriggerProps: _empty.EMPTY_OBJECT,
      popupProps: _empty.EMPTY_OBJECT
    });
  }, [store]);
}
function usePopupRootSync(store, open) {
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!open && store.state.openMethod !== null) {
      store.set('openMethod', null);
    }
  }, [open, store]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => () => {
    if (store.state.openMethod !== null) {
      store.set('openMethod', null);
    }
  }, [store]);
}