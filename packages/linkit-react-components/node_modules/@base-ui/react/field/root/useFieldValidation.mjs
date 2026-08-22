'use client';

import * as React from 'react';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { useTimeout } from '@base-ui/utils/useTimeout';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useRefWithInit } from '@base-ui/utils/useRefWithInit';
import { useLabelableContext } from "../../internals/labelable-provider/LabelableContext.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { DEFAULT_VALIDITY_STATE } from "../../internals/field-constants/constants.mjs";
import { useFormContext } from "../../internals/form-context/FormContext.mjs";
import { getCombinedFieldValidityData } from "../utils/getCombinedFieldValidityData.mjs";
const validityKeys = Object.keys(DEFAULT_VALIDITY_STATE);
/**
 * Whether an input participates in the surrounding Base UI Form. Inputs that are effectively
 * disabled, or whose `form` attribute explicitly associates them with another form, are excluded.
 * DOM position only matters when it associates the input with a different form. Otherwise, field
 * registration is context-driven, so portaled inputs (for example inside a dialog) still belong to
 * the form for both validation and values projected into `onFormSubmit`.
 */
export function isEligibleInput(input, formElement) {
  if (input.matches(':disabled')) {
    return false;
  }
  if (!formElement || input.form === formElement) {
    return true;
  }

  // React context crosses portal boundaries. An unassociated portaled input still participates in
  // contextual validation, unless an explicit `form` attribute opts it out of the surrounding Form.
  return input.form === null && !input.hasAttribute('form');
}

/**
 * Picks the input whose native validity should represent a field that owns several inputs (such as a
 * checkbox or radio group). Prefers the first eligible currently-invalid input, where "first" follows
 * registration order (mount order), and otherwise returns the first eligible input.
 */
function findRepresentativeInput(inputs, formElement) {
  let fallback = null;
  for (const input of inputs.keys()) {
    if (!isEligibleInput(input, formElement)) {
      continue;
    }
    if (!input.validity.valid) {
      return input;
    }
    fallback ??= input;
  }
  return fallback;
}
function clearCustomValidity(element, inputs) {
  for (const input of inputs.keys()) {
    input.setCustomValidity('');
  }
  element?.setCustomValidity('');
}
export function useFieldValidation(params) {
  const {
    elementRef,
    formRef
  } = useFormContext();
  const {
    setValidityData,
    validate,
    validityData,
    validationDebounceTime,
    invalid,
    markedDirtyRef,
    state,
    shouldValidateOnChange,
    registeredFieldIdRef
  } = params;
  const {
    controlId,
    getDescriptionProps
  } = useLabelableContext();
  const timeout = useTimeout();
  const inputRef = React.useRef(null);
  const registeredInputs = useRefWithInit(() => new Map()).current;
  const validationCommitIdRef = React.useRef(0);

  // Groups register several inputs against a single field so focus, validation, and form-value
  // projection can use the same live controls. This also ensures a `required` checkbox can't be
  // satisfied by another input in the group, matching native per-checkbox behavior.
  const registerInput = React.useCallback((element, registration) => {
    registeredInputs.set(element, registration);
    return () => {
      registeredInputs.delete(element);
    };
  }, [registeredInputs]);
  const getInputControl = useStableCallback(() => {
    const element = findRepresentativeInput(registeredInputs, elementRef.current);
    return element && registeredInputs.get(element)?.controlRef.current || null;
  });
  const commit = useStableCallback(async (value, revalidate = false) => {
    validationCommitIdRef.current += 1;
    const validationCommitId = validationCommitIdRef.current;
    function updateRegisteredFieldValidity(nextValidityData, externalInvalid = invalid) {
      const fieldId = registeredFieldIdRef.current ?? controlId;
      if (fieldId == null) {
        return;
      }
      const currentFieldData = formRef.current.fields.get(fieldId);
      if (!currentFieldData) {
        return;
      }
      const validityDataWithFormErrors = getCombinedFieldValidityData(nextValidityData, externalInvalid);
      formRef.current.fields.set(fieldId, {
        ...currentFieldData,
        validityData: validityDataWithFormErrors
      });
    }
    function publishAllValid(input, externalInvalid) {
      const nextValidityData = {
        value,
        state: {
          ...DEFAULT_VALIDITY_STATE,
          valid: true
        },
        error: '',
        errors: [],
        initialValue: validityData.initialValue
      };
      clearCustomValidity(input, registeredInputs);
      updateRegisteredFieldValidity(nextValidityData, externalInvalid);
      setValidityData(nextValidityData);
    }

    // A field can own several inputs (such as a checkbox or radio group), but only the last-mounted
    // one wins the shared `inputRef`. Validate against the registry instead so every input counts;
    // `inputRef` is the fallback only when no inputs are registered.
    const element = registeredInputs.size > 0 ? findRepresentativeInput(registeredInputs, elementRef.current) : inputRef.current;
    // A field with no eligible input has no native constraint, but its custom validator still
    // applies to the logical value at the configured validation boundary.

    if (revalidate) {
      if (state.valid !== false || !element) {
        return;
      }
      const currentNativeValidity = element.validity;
      if (!currentNativeValidity.valueMissing) {
        // The 'valueMissing' (required) condition has been resolved by the user typing.
        // Temporarily mark the field as valid for this onChange event.
        // Other native errors (e.g., typeMismatch) will be caught by full validation on blur or submit.
        // The required value is now present; ignore stale external invalid state for this pass.
        publishAllValid(element, false);
        return;
      }

      // A stale custom error can coexist with valueMissing, but defer any other native errors.
      for (const key of validityKeys) {
        if (key !== 'valid' && key !== 'valueMissing' && key !== 'customError' && currentNativeValidity[key]) {
          return;
        }
      }

      // Value is still missing: publish the current native state so valueMissing and the changed
      // value are observable immediately. Full custom validation still waits for its boundary.
    }
    function getState(el) {
      const computedState = validityKeys.reduce((acc, key) => {
        acc[key] = el.validity[key];
        return acc;
      }, {});
      let hasOnlyValueMissingError = false;
      for (const key of validityKeys) {
        if (key === 'valid') {
          continue;
        }
        if (key === 'valueMissing' && computedState[key]) {
          hasOnlyValueMissingError = true;
        } else if (computedState[key]) {
          return computedState;
        }
      }

      // Only make `valueMissing` mark the field invalid if it's been changed
      // to reduce error noise.
      if (hasOnlyValueMissingError && !markedDirtyRef.current) {
        computedState.valid = true;
        computedState.valueMissing = false;
      }
      return computedState;
    }
    timeout.clear();
    let result = null;
    let validationErrors = [];

    // With no representative input the field carries no native constraint, so start from an
    // all-valid native state and let the custom `validate` result below decide the outcome.
    const nextState = element ? getState(element) : {
      ...DEFAULT_VALIDITY_STATE,
      valid: true
    };
    let defaultValidationMessage;
    const isValidatingOnChange = shouldValidateOnChange();
    if (element && element.validationMessage && !isValidatingOnChange) {
      // not validating on change, if there is a `validationMessage` from
      // native validity, set errors and skip calling the custom validate fn
      defaultValidationMessage = element.validationMessage;
      validationErrors = [element.validationMessage];
    } else {
      // call the validate function because either
      // - validating on change, or
      // - native constraint validations passed, custom validity check is next
      const formValues = Array.from(formRef.current.fields.values()).reduce((acc, field) => {
        if (field.name) {
          acc[field.name] = field.getValue();
        }
        return acc;
      }, {});
      const resultOrPromise = validate(value, formValues);
      if (typeof resultOrPromise === 'object' && resultOrPromise !== null && 'then' in resultOrPromise) {
        result = await resultOrPromise;
        if (validationCommitId !== validationCommitIdRef.current) {
          return;
        }
      } else {
        result = resultOrPromise;
      }
      if (result !== null) {
        nextState.valid = false;
        nextState.customError = true;
        if (Array.isArray(result)) {
          validationErrors = result;
          element?.setCustomValidity(result.join('\n'));
        } else if (result) {
          validationErrors = [result];
          element?.setCustomValidity(result);
        }
      } else if (isValidatingOnChange) {
        // validate function returned no errors, if validating on change
        // we need to clear the custom validity state
        clearCustomValidity(element, registeredInputs);
        nextState.customError = false;
        if (element && element.validationMessage) {
          defaultValidationMessage = element.validationMessage;
          validationErrors = [element.validationMessage];
        } else if ((!element || element.validity.valid) && !nextState.valid) {
          nextState.valid = true;
        }
      }
    }
    const nextValidityData = {
      value,
      state: nextState,
      error: defaultValidationMessage ?? (Array.isArray(result) ? result[0] : result ?? ''),
      errors: validationErrors,
      initialValue: validityData.initialValue
    };

    // Keep Form-level errors part of overall field validity for submit blocking/focus logic.
    updateRegisteredFieldValidity(nextValidityData);
    setValidityData(nextValidityData);
  });
  const change = useStableCallback(value => {
    timeout.clear();
    const validateOnChange = shouldValidateOnChange();
    if (validateOnChange && value !== '' && validationDebounceTime) {
      validationCommitIdRef.current += 1;
      timeout.start(validationDebounceTime, () => {
        commit(value);
      });
    } else {
      commit(value, !validateOnChange);
    }
  });
  const getValidationProps = React.useCallback((disabled, externalProps = {}) => mergeProps(getDescriptionProps(externalProps), state.valid === false && !state.disabled && !disabled ? {
    'aria-invalid': true
  } : EMPTY_OBJECT), [getDescriptionProps, state.disabled, state.valid]);
  return React.useMemo(() => ({
    getValidationProps,
    inputRef,
    registeredInputs,
    registerInput,
    getInputControl,
    commit,
    change
  }), [getValidationProps, registeredInputs, registerInput, getInputControl, commit, change]);
}