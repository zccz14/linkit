"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TabsIndicator = void 0;
var React = _interopRequireWildcard(require("react"));
var _useForcedRerendering = require("@base-ui/utils/useForcedRerendering");
var _indicator = require("#prehydration/tabs/indicator");
var _useRenderElement = require("../../internals/useRenderElement");
var _getCssDimensions = require("../../utils/getCssDimensions");
var _PrehydrationScript2 = require("../../internals/PrehydrationScript");
var _TabsRootContext = require("../root/TabsRootContext");
var _stateAttributesMapping = require("../root/stateAttributesMapping");
var _TabsListContext = require("../list/TabsListContext");
var _jsxRuntime = require("react/jsx-runtime");
var _PrehydrationScript;
const stateAttributesMapping = {
  ..._stateAttributesMapping.tabsStateAttributesMapping,
  activeTabPosition: () => null,
  activeTabSize: () => null
};

/**
 * A visual indicator that can be styled to match the position of the currently active tab.
 * Renders a `<span>` element.
 *
 * Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
 */
const TabsIndicator = exports.TabsIndicator = /*#__PURE__*/React.forwardRef(function TabsIndicator(componentProps, forwardedRef) {
  const {
    className,
    render,
    renderBeforeHydration = false,
    style: styleProp,
    ...elementProps
  } = componentProps;
  const {
    getTabElementBySelectedValue,
    orientation,
    tabActivationDirection,
    value
  } = (0, _TabsRootContext.useTabsRootContext)();
  const {
    tabsListElement,
    registerIndicatorUpdateListener
  } = (0, _TabsListContext.useTabsListContext)();
  const rerender = (0, _useForcedRerendering.useForcedRerendering)();
  React.useEffect(() => {
    return registerIndicatorUpdateListener(rerender);
  }, [registerIndicatorUpdateListener, rerender]);
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  let width = 0;
  let height = 0;
  let isTabSelected = false;
  if (value != null && tabsListElement != null) {
    const activeTab = getTabElementBySelectedValue(value);
    if (activeTab != null) {
      isTabSelected = true;
      const {
        width: computedWidth,
        height: computedHeight
      } = (0, _getCssDimensions.getCssDimensions)(activeTab);
      const {
        width: tabListWidth,
        height: tabListHeight
      } = (0, _getCssDimensions.getCssDimensions)(tabsListElement);
      const tabRect = activeTab.getBoundingClientRect();
      const tabsListRect = tabsListElement.getBoundingClientRect();
      const scaleX = tabListWidth > 0 ? tabsListRect.width / tabListWidth : 1;
      const scaleY = tabListHeight > 0 ? tabsListRect.height / tabListHeight : 1;
      const hasNonZeroScale = scaleX > Number.EPSILON && scaleY > Number.EPSILON;
      if (hasNonZeroScale) {
        const tabLeftDelta = tabRect.left - tabsListRect.left;
        const tabTopDelta = tabRect.top - tabsListRect.top;
        left = tabLeftDelta / scaleX + tabsListElement.scrollLeft - tabsListElement.clientLeft;
        top = tabTopDelta / scaleY + tabsListElement.scrollTop - tabsListElement.clientTop;
      } else {
        left = activeTab.offsetLeft;
        top = activeTab.offsetTop;
      }
      width = computedWidth;
      height = computedHeight;
      right = tabsListElement.scrollWidth - left - width;
      bottom = tabsListElement.scrollHeight - top - height;
    }
  }
  const activeTabPosition = isTabSelected ? {
    left,
    right,
    top,
    bottom
  } : null;
  const activeTabSize = isTabSelected ? {
    width,
    height
  } : null;
  const style = isTabSelected ? {
    '--active-tab-left': `${left}px`,
    '--active-tab-right': `${right}px`,
    '--active-tab-top': `${top}px`,
    '--active-tab-bottom': `${bottom}px`,
    '--active-tab-width': `${width}px`,
    '--active-tab-height': `${height}px`
  } : undefined;
  const displayIndicator = isTabSelected && width > 0 && height > 0;
  const state = {
    orientation,
    activeTabPosition,
    activeTabSize,
    tabActivationDirection
  };
  const element = (0, _useRenderElement.useRenderElement)('span', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      role: 'presentation',
      style,
      hidden: !displayIndicator // do not display the indicator before the layout is settled
    }, elementProps, {
      suppressHydrationWarning: true
    }],
    stateAttributesMapping
  });
  if (value == null) {
    return null;
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(React.Fragment, {
    children: [element, renderBeforeHydration && (_PrehydrationScript || (_PrehydrationScript = /*#__PURE__*/(0, _jsxRuntime.jsx)(_PrehydrationScript2.PrehydrationScript, {
      script: _indicator.script
    })))]
  });
});
if (process.env.NODE_ENV !== "production") TabsIndicator.displayName = "TabsIndicator";