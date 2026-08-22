"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.scrollAreaStateAttributesMapping = void 0;
// Data-attribute strings inlined so `ScrollAreaRootDataAttributes` tree-shakes out.
const attr = name => value => value ? {
  [name]: ''
} : null;
const scrollAreaStateAttributesMapping = exports.scrollAreaStateAttributesMapping = {
  hasOverflowX: attr('data-has-overflow-x'),
  hasOverflowY: attr('data-has-overflow-y'),
  overflowXStart: attr('data-overflow-x-start'),
  overflowXEnd: attr('data-overflow-x-end'),
  overflowYStart: attr('data-overflow-y-start'),
  overflowYEnd: attr('data-overflow-y-end'),
  cornerHidden: () => null
};