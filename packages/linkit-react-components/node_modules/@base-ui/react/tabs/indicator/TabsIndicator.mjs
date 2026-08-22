'use client';

var _PrehydrationScript;
import * as React from 'react';
import { useForcedRerendering } from '@base-ui/utils/useForcedRerendering';
import { script as prehydrationScript } from '#prehydration/tabs/indicator';
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { getCssDimensions } from "../../utils/getCssDimensions.mjs";
import { PrehydrationScript } from "../../internals/PrehydrationScript.mjs";
import { useTabsRootContext } from "../root/TabsRootContext.mjs";
import { tabsStateAttributesMapping } from "../root/stateAttributesMapping.mjs";
import { useTabsListContext } from "../list/TabsListContext.mjs";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const stateAttributesMapping = {
  ...tabsStateAttributesMapping,
  activeTabPosition: () => null,
  activeTabSize: () => null
};

/**
 * A visual indicator that can be styled to match the position of the currently active tab.
 * Renders a `<span>` element.
 *
 * Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
 */
export const TabsIndicator = /*#__PURE__*/React.forwardRef(function TabsIndicator(componentProps, forwardedRef) {
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
  } = useTabsRootContext();
  const {
    tabsListElement,
    registerIndicatorUpdateListener
  } = useTabsListContext();
  const rerender = useForcedRerendering();
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
      } = getCssDimensions(activeTab);
      const {
        width: tabListWidth,
        height: tabListHeight
      } = getCssDimensions(tabsListElement);
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
  const element = useRenderElement('span', componentProps, {
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
  return /*#__PURE__*/_jsxs(React.Fragment, {
    children: [element, renderBeforeHydration && (_PrehydrationScript || (_PrehydrationScript = /*#__PURE__*/_jsx(PrehydrationScript, {
      script: prehydrationScript
    })))]
  });
});
if (process.env.NODE_ENV !== "production") TabsIndicator.displayName = "TabsIndicator";