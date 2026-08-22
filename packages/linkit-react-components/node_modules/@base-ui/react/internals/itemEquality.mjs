export const defaultItemEquality = (itemValue, selectedValue) => Object.is(itemValue, selectedValue);
export function compareItemEquality(itemValue, selectedValue, comparer) {
  if (itemValue == null || selectedValue == null) {
    return Object.is(itemValue, selectedValue);
  }
  return comparer(itemValue, selectedValue);
}
export function selectedValueIncludes(selectedValues, itemValue, comparer) {
  if (!selectedValues || selectedValues.length === 0) {
    return false;
  }
  return selectedValues.some(selectedValue => {
    if (selectedValue === undefined) {
      return false;
    }
    return compareItemEquality(itemValue, selectedValue, comparer);
  });
}
export function findItemIndex(itemValues, selectedValue, comparer) {
  if (!itemValues || itemValues.length === 0) {
    return -1;
  }
  return itemValues.findIndex(itemValue => {
    if (itemValue === undefined) {
      return false;
    }
    return compareItemEquality(itemValue, selectedValue, comparer);
  });
}
export function findSelectionIndex(itemValues, selectedValue, comparer, multiple) {
  // Only unwrap in multiple mode: an array can itself be a valid single-select value.
  const lastValue = multiple && Array.isArray(selectedValue) ? selectedValue[selectedValue.length - 1] : selectedValue;
  const index = findItemIndex(itemValues, lastValue, comparer);
  return index === -1 ? null : index;
}
export function removeItem(selectedValues, itemValue, comparer) {
  return selectedValues.filter(selectedValue => !compareItemEquality(itemValue, selectedValue, comparer));
}