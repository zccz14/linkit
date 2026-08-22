import { transitionStatusMapping } from "../../internals/stateAttributesMapping.mjs";
import { fieldValidityMapping } from "../../internals/field-constants/constants.mjs";
export const stateAttributesMapping = {
  checked(value) {
    if (value) {
      return {
        'data-checked': ''
      };
    }
    return {
      'data-unchecked': ''
    };
  },
  ...transitionStatusMapping,
  ...fieldValidityMapping
};