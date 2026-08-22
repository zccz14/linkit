"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.stateAttributesMapping = void 0;
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _constants = require("../../internals/field-constants/constants");
const stateAttributesMapping = exports.stateAttributesMapping = {
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
  ..._stateAttributesMapping.transitionStatusMapping,
  ..._constants.fieldValidityMapping
};