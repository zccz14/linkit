"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CollapsibleRootDataAttributes = void 0;
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
let CollapsibleRootDataAttributes = exports.CollapsibleRootDataAttributes = function (CollapsibleRootDataAttributes) {
  /**
   * Present when the collapsible is open.
   */
  CollapsibleRootDataAttributes["open"] = "data-open";
  /**
   * Present when the collapsible is closed.
   */
  CollapsibleRootDataAttributes["closed"] = "data-closed";
  /**
   * Present when the collapsible begins animating in.
   */
  CollapsibleRootDataAttributes[CollapsibleRootDataAttributes["startingStyle"] = _stateAttributesMapping.TransitionStatusDataAttributes.startingStyle] = "startingStyle";
  /**
   * Present when the collapsible is animating out.
   */
  CollapsibleRootDataAttributes[CollapsibleRootDataAttributes["endingStyle"] = _stateAttributesMapping.TransitionStatusDataAttributes.endingStyle] = "endingStyle";
  return CollapsibleRootDataAttributes;
}({});