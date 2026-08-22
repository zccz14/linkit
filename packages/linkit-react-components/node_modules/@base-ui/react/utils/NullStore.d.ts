import { ReactStore } from '@base-ui/utils/store';
type SelectorFunction<State> = (state: State, ...args: any[]) => any;
/**
 * A `ReactStore` whose state never changes.
 *
 * Useful for fallback stores that need to support normal store reads while detached from the
 * component that owns real state. Context values may still contain mutable refs or maps.
 */
export declare class NullStore<State extends object, Context = Record<string, never>, Selectors extends Record<string, SelectorFunction<State>> = Record<string, never>> extends ReactStore<State, Context, Selectors> {
  setState(_newState: State): void;
  update(_changes: Partial<State>): void;
  set<T>(_key: keyof State, _value: T): void;
  notifyAll(): void;
}
export {};