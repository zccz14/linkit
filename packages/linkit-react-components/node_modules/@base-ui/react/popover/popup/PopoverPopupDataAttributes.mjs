import { CommonPopupDataAttributes } from "../../utils/popupStateMapping.mjs";
export let PopoverPopupDataAttributes = function (PopoverPopupDataAttributes) {
  /**
   * Present when the popup is open.
   */
  PopoverPopupDataAttributes[PopoverPopupDataAttributes["open"] = CommonPopupDataAttributes.open] = "open";
  /**
   * Present when the popup is closed.
   */
  PopoverPopupDataAttributes[PopoverPopupDataAttributes["closed"] = CommonPopupDataAttributes.closed] = "closed";
  /**
   * Present when the popup begins animating in.
   */
  PopoverPopupDataAttributes[PopoverPopupDataAttributes["startingStyle"] = CommonPopupDataAttributes.startingStyle] = "startingStyle";
  /**
   * Present when the popup is animating out.
   */
  PopoverPopupDataAttributes[PopoverPopupDataAttributes["endingStyle"] = CommonPopupDataAttributes.endingStyle] = "endingStyle";
  /**
   * Indicates which side the popup is positioned relative to the trigger.
   * @type {'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start'}
   */
  PopoverPopupDataAttributes[PopoverPopupDataAttributes["side"] = CommonPopupDataAttributes.side] = "side";
  /**
   * Indicates how the popup is aligned relative to specified side.
   * @type {'start' | 'center' | 'end'}
   */
  PopoverPopupDataAttributes[PopoverPopupDataAttributes["align"] = CommonPopupDataAttributes.align] = "align";
  /**
   * Present if animations should be instant.
   * @type {'click' | 'dismiss' | 'focus' | 'trigger-change'}
   */
  PopoverPopupDataAttributes["instant"] = "data-instant";
  return PopoverPopupDataAttributes;
}({});