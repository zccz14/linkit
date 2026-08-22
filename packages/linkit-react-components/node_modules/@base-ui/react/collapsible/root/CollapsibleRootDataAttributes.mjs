import { TransitionStatusDataAttributes } from "../../internals/stateAttributesMapping.mjs";
export let CollapsibleRootDataAttributes = function (CollapsibleRootDataAttributes) {
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
  CollapsibleRootDataAttributes[CollapsibleRootDataAttributes["startingStyle"] = TransitionStatusDataAttributes.startingStyle] = "startingStyle";
  /**
   * Present when the collapsible is animating out.
   */
  CollapsibleRootDataAttributes[CollapsibleRootDataAttributes["endingStyle"] = TransitionStatusDataAttributes.endingStyle] = "endingStyle";
  return CollapsibleRootDataAttributes;
}({});