import { collapsibleOpenStateMapping as baseMapping } from "../../utils/collapsibleOpenStateMapping.mjs";
import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { AccordionItemDataAttributes } from "./AccordionItemDataAttributes.mjs";
export const accordionStateAttributesMapping = {
  ...baseMapping,
  index: value => ({
    [AccordionItemDataAttributes.index]: String(value)
  }),
  ...transitionStatusMapping,
  value: () => null
};