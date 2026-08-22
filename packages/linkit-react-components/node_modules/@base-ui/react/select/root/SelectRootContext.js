"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectRootContext = void 0;
exports.useSelectRootContext = useSelectRootContext;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
const SelectRootContext = exports.SelectRootContext = /*#__PURE__*/React.createContext(null);
if (process.env.NODE_ENV !== "production") SelectRootContext.displayName = "SelectRootContext";
function useSelectRootContext() {
  const context = React.useContext(SelectRootContext);
  if (context === null) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: SelectRootContext is missing. Select parts must be placed within <Select.Root>.' : (0, _formatErrorMessage2.default)(60));
  }
  return context;
}