"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.triggerOpenStateMapping = exports.pressableTriggerOpenStateMapping = exports.popupTransitionStateMapping = exports.popupStateMapping = exports.CommonTriggerDataAttributes = exports.CommonPopupDataAttributes = void 0;
var _stateAttributesMapping = require("../internals/stateAttributesMapping");
let CommonPopupDataAttributes = exports.CommonPopupDataAttributes = function (CommonPopupDataAttributes) {
  /**
   * Present when the popup is open.
   */
  CommonPopupDataAttributes["open"] = "data-open";
  /**
   * Present when the popup is closed.
   */
  CommonPopupDataAttributes["closed"] = "data-closed";
  /**
   * Present when the popup begins animating in.
   */
  CommonPopupDataAttributes[CommonPopupDataAttributes["startingStyle"] = _stateAttributesMapping.TransitionStatusDataAttributes.startingStyle] = "startingStyle";
  /**
   * Present when the popup is animating out.
   */
  CommonPopupDataAttributes[CommonPopupDataAttributes["endingStyle"] = _stateAttributesMapping.TransitionStatusDataAttributes.endingStyle] = "endingStyle";
  /**
   * Present when the anchor is hidden.
   */
  CommonPopupDataAttributes["anchorHidden"] = "data-anchor-hidden";
  /**
   * Indicates which side the popup is positioned relative to the trigger.
   * @type { 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start'}
   */
  CommonPopupDataAttributes["side"] = "data-side";
  /**
   * Indicates how the popup is aligned relative to specified side.
   * @type {'start' | 'center' | 'end'}
   */
  CommonPopupDataAttributes["align"] = "data-align";
  return CommonPopupDataAttributes;
}({});
let CommonTriggerDataAttributes = exports.CommonTriggerDataAttributes = /*#__PURE__*/function (CommonTriggerDataAttributes) {
  /**
   * Present when the popup is open.
   */
  CommonTriggerDataAttributes["popupOpen"] = "data-popup-open";
  /**
   * Present when a pressable trigger is pressed.
   */
  CommonTriggerDataAttributes["pressed"] = "data-pressed";
  return CommonTriggerDataAttributes;
}({}); // Literal keys (instead of enum member references) keep the docs-only enums above
// tree-shakeable: a runtime reference would retain the whole enum IIFE in every bundle.
const TRIGGER_HOOK = {
  'data-popup-open': ''
};
const PRESSABLE_TRIGGER_HOOK = {
  'data-popup-open': '',
  'data-pressed': ''
};
const POPUP_OPEN_HOOK = {
  'data-open': ''
};
const POPUP_CLOSED_HOOK = {
  'data-closed': ''
};
const ANCHOR_HIDDEN_HOOK = {
  'data-anchor-hidden': ''
};
const triggerOpenStateMapping = exports.triggerOpenStateMapping = {
  open(value) {
    if (value) {
      return TRIGGER_HOOK;
    }
    return null;
  }
};
const pressableTriggerOpenStateMapping = exports.pressableTriggerOpenStateMapping = {
  open(value) {
    if (value) {
      return PRESSABLE_TRIGGER_HOOK;
    }
    return null;
  }
};
const popupStateMapping = exports.popupStateMapping = {
  open(value) {
    if (value) {
      return POPUP_OPEN_HOOK;
    }
    return POPUP_CLOSED_HOOK;
  },
  anchorHidden(value) {
    if (value) {
      return ANCHOR_HIDDEN_HOOK;
    }
    return null;
  }
};
const popupTransitionStateMapping = exports.popupTransitionStateMapping = {
  ...popupStateMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};