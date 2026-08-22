import { fieldValidityMapping } from "../../internals/field-constants/constants.mjs";
export function getCheckboxStateAttributesMapping(state) {
  return {
    checked(value) {
      if (state.indeterminate) {
        // `data-indeterminate` is already handled by the `indeterminate` prop.
        return {};
      }
      if (value) {
        return {
          'data-checked': ''
        };
      }
      return {
        'data-unchecked': ''
      };
    },
    ...fieldValidityMapping
  };
}