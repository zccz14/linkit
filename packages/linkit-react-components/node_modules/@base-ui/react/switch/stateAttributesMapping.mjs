import { fieldValidityMapping } from "../internals/field-constants/constants.mjs";
export const stateAttributesMapping = {
  ...fieldValidityMapping,
  checked(value) {
    if (value) {
      return {
        'data-checked': ''
      };
    }
    return {
      'data-unchecked': ''
    };
  }
};