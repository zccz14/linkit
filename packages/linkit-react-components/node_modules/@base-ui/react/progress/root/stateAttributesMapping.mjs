export const progressStateAttributesMapping = {
  status(value) {
    return {
      [`data-${value}`]: ''
    };
  }
};