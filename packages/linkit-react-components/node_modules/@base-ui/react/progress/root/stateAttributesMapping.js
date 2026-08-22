"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.progressStateAttributesMapping = void 0;
const progressStateAttributesMapping = exports.progressStateAttributesMapping = {
  status(value) {
    return {
      [`data-${value}`]: ''
    };
  }
};