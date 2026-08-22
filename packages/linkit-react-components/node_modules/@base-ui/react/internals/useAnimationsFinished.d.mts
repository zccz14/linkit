import * as React from 'react';
/**
 * Executes a function once all animations have finished on the provided element.
 * If an animation is canceled, waits for any replacement animations before executing.
 * @param elementOrRef - The element to watch for animations.
 * @param waitForStartingStyleRemoved - Whether to wait for [data-starting-style] to be removed before checking for animations.
 * @returns A function that takes a callback to execute once all animations have finished, and an optional AbortSignal to abort the callback
 */
export declare function useAnimationsFinished(elementOrRef: React.RefObject<HTMLElement | null> | HTMLElement | null, waitForStartingStyleRemoved?: boolean): (fnToExecute: () => void, signal?: AbortSignal | null) => void;