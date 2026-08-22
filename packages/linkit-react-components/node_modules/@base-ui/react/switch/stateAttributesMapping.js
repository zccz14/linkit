"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.stateAttributesMapping = void 0;
var _constants = require("../internals/field-constants/constants");
const stateAttributesMapping = exports.stateAttributesMapping = {
  ..._constants.fieldValidityMapping,
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