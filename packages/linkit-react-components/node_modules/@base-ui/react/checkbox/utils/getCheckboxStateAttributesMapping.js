"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getCheckboxStateAttributesMapping = getCheckboxStateAttributesMapping;
var _constants = require("../../internals/field-constants/constants");
function getCheckboxStateAttributesMapping(state) {
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
    ..._constants.fieldValidityMapping
  };
}