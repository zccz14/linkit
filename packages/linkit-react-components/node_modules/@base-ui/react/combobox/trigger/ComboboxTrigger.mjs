'use client';

import * as React from 'react';
import { useStore } from '@base-ui/utils/store';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useTimeout } from '@base-ui/utils/useTimeout';
import { ownerDocument } from '@base-ui/utils/owner';
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useButton } from "../../internals/use-button/index.mjs";
import { useComboboxFloatingContext, useComboboxInputValueContext, useComboboxRootContext } from "../root/ComboboxRootContext.mjs";
import { triggerStateAttributesMapping } from "../utils/stateAttributesMapping.mjs";
import { selectors } from "../store.mjs";
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useLabelableContext } from "../../internals/labelable-provider/LabelableContext.mjs";
import { stopEvent, contains, getTarget } from "../../floating-ui-react/utils.mjs";
import { isMouseWithinBounds } from "../../utils/getPseudoElementBounds.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { useClick, useTypeahead } from "../../floating-ui-react/index.mjs";
import { useLabelableId } from "../../internals/labelable-provider/useLabelableId.mjs";
import { resolveAriaLabelledBy } from "../../utils/resolveAriaLabelledBy.mjs";
import { getComboboxPopupId } from "../root/utils/index.mjs";
import { useListEmpty, usePopupSide } from "../utils/parts.mjs";

/**
 * A button that opens the popup.
 * Renders a `<button>` element.
 *
 * Documentation: [Base UI Combobox](https://base-ui.com/react/components/combobox)
 */
export const ComboboxTrigger = /*#__PURE__*/React.forwardRef(function ComboboxTrigger(componentProps, forwardedRef) {
  const {
    render,
    className,
    nativeButton = true,
    disabled: disabledProp = false,
    id: idProp,
    style,
    ...elementProps
  } = componentProps;
  const {
    state: fieldState,
    disabled: fieldDisabled,
    setTouched,
    setFocused,
    validationMode,
    validation
  } = useFieldRootContext();
  const {
    labelId: fieldLabelId
  } = useLabelableContext();
  const store = useComboboxRootContext();
  const selectionMode = useStore(store, selectors.selectionMode);
  const comboboxDisabled = useStore(store, selectors.disabled);
  const readOnly = useStore(store, selectors.readOnly);
  const required = useStore(store, selectors.required);
  const positionerElement = useStore(store, selectors.positionerElement);
  const listElement = useStore(store, selectors.listElement);
  const storedPopupId = useStore(store, selectors.popupId);
  const triggerProps = useStore(store, selectors.triggerProps);
  const inputInsidePopup = useStore(store, selectors.inputInsidePopup);
  const rootId = useStore(store, selectors.id);
  const comboboxLabelId = useStore(store, selectors.labelId);
  const open = useStore(store, selectors.open);
  const selectedValue = useStore(store, selectors.selectedValue);
  const activeIndex = useStore(store, selectors.activeIndex);
  const selectedIndex = useStore(store, selectors.selectedIndex);
  const hasSelectedValue = useStore(store, selectors.hasSelectedValue);
  const floatingRootContext = useComboboxFloatingContext();
  const inputValue = useComboboxInputValueContext();
  const focusTimeout = useTimeout();
  const disabled = fieldDisabled || comboboxDisabled || disabledProp;
  const listEmpty = useListEmpty();
  const popupSide = usePopupSide(store);
  useLabelableId({
    id: inputInsidePopup ? idProp : undefined
  });
  const id = inputInsidePopup ? idProp ?? rootId : idProp;
  const ariaLabelledBy = resolveAriaLabelledBy(fieldLabelId, comboboxLabelId);
  let ariaControls;
  if (open && inputInsidePopup) {
    // Fall back to the default id while the popup registers its own (custom ids are stored once the
    // popup mounts), so `aria-controls` is set on the same commit `open` becomes `true`.
    ariaControls = storedPopupId ?? getComboboxPopupId(rootId);
  } else if (open) {
    ariaControls = listElement?.id;
  }
  const currentPointerTypeRef = React.useRef('');
  function trackPointerType(event) {
    currentPointerTypeRef.current = event.pointerType;
  }
  const {
    reference: triggerTypeaheadProps
  } = useTypeahead(floatingRootContext, {
    enabled: !open && !readOnly && !comboboxDisabled && selectionMode === 'single',
    listRef: store.state.labelsRef,
    activeIndex,
    selectedIndex,
    onMatch(index) {
      const nextSelectedValue = store.state.valuesRef.current[index];
      if (nextSelectedValue !== undefined) {
        store.state.setSelectedValue(nextSelectedValue, createChangeEventDetails(REASONS.none));
      }
    }
  });
  const {
    reference: triggerClickProps
  } = useClick(floatingRootContext, {
    enabled: !readOnly && !comboboxDisabled,
    event: 'mousedown'
  });
  const {
    buttonRef,
    getButtonProps
  } = useButton({
    native: nativeButton,
    disabled
  });
  const state = {
    ...fieldState,
    open,
    disabled,
    popupSide,
    listEmpty,
    placeholder: selectionMode === 'none' ? false : !hasSelectedValue
  };
  const setTriggerElement = useStableCallback(element => {
    store.set('triggerElement', element);
  });
  const element = useRenderElement('button', componentProps, {
    ref: [forwardedRef, buttonRef, setTriggerElement],
    state,
    props: [triggerProps, triggerClickProps, triggerTypeaheadProps, {
      id,
      tabIndex: inputInsidePopup ? 0 : -1,
      role: inputInsidePopup ? 'combobox' : undefined,
      'aria-expanded': open,
      'aria-haspopup': inputInsidePopup ? 'dialog' : 'listbox',
      'aria-controls': ariaControls,
      'aria-required': inputInsidePopup ? required || undefined : undefined,
      'aria-labelledby': ariaLabelledBy,
      onPointerDown: trackPointerType,
      onPointerEnter: trackPointerType,
      onFocus() {
        setFocused(true);
        if (disabled || readOnly) {
          return;
        }
        focusTimeout.start(0, store.state.forceMount);
      },
      onBlur(event) {
        // If focus is moving into the popup, don't count it as a blur.
        if (contains(positionerElement, event.relatedTarget)) {
          return;
        }
        setTouched(true);
        setFocused(false);
        if (validationMode === 'onBlur') {
          const valueToValidate = selectionMode === 'none' ? inputValue : selectedValue;
          validation.commit(valueToValidate);
        }
      },
      onMouseDown(event) {
        if (disabled || readOnly) {
          return;
        }
        if (!inputInsidePopup) {
          floatingRootContext.set('domReferenceElement', event.currentTarget);
        }

        // Ensure items are registered for initial selection highlight.
        store.state.forceMount();
        if (currentPointerTypeRef.current !== 'touch') {
          store.state.inputRef.current?.focus();
          if (!inputInsidePopup) {
            event.preventDefault();
          }
        }
        if (open) {
          return;
        }
        const doc = ownerDocument(event.currentTarget);
        function handleMouseUp(mouseEvent) {
          const currentTriggerElement = store.state.triggerElement;
          if (!currentTriggerElement) {
            return;
          }
          const mouseUpTarget = getTarget(mouseEvent);
          const positioner = store.state.positionerElement;
          const list = store.state.listElement;
          if (contains(currentTriggerElement, mouseUpTarget) || contains(positioner, mouseUpTarget) || contains(list, mouseUpTarget)) {
            return;
          }
          if (isMouseWithinBounds(mouseEvent, currentTriggerElement)) {
            return;
          }
          store.state.setOpen(false, createChangeEventDetails(REASONS.cancelOpen, mouseEvent));
        }
        if (inputInsidePopup) {
          doc.addEventListener('mouseup', handleMouseUp, {
            once: true
          });
        }
      },
      onKeyDown(event) {
        if (readOnly) {
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          stopEvent(event);
          store.state.setOpen(true, createChangeEventDetails(REASONS.listNavigation, event.nativeEvent));
          store.state.inputRef.current?.focus();
        }
      }
    }, validation.getValidationProps(disabled, elementProps), getButtonProps],
    stateAttributesMapping: triggerStateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ComboboxTrigger.displayName = "ComboboxTrigger";