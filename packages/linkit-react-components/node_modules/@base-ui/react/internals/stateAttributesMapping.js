"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.transitionStatusMapping = exports.TransitionStatusDataAttributes = void 0;
let TransitionStatusDataAttributes = exports.TransitionStatusDataAttributes = /*#__PURE__*/function (TransitionStatusDataAttributes) {
  /**
   * Present when the component begins animating in.
   */
  TransitionStatusDataAttributes["startingStyle"] = "data-starting-style";
  /**
   * Present when the component is animating out.
   */
  TransitionStatusDataAttributes["endingStyle"] = "data-ending-style";
  return TransitionStatusDataAttributes;
}({});
const STARTING_HOOK = {
  'data-starting-style': ''
};
const ENDING_HOOK = {
  'data-ending-style': ''
};
const transitionStatusMapping = exports.transitionStatusMapping = {
  transitionStatus(value) {
    if (value === 'starting') {
      return STARTING_HOOK;
    }
    if (value === 'ending') {
      return ENDING_HOOK;
    }
    return null;
  }
};