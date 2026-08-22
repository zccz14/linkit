import * as React from 'react';
export declare const LabelableProvider: React.FC<LabelableProvider.Props>;
export interface LabelableProviderState {}
export interface LabelableProviderProps {
  controlId?: string | null | undefined;
  labelId?: string | undefined;
  children?: React.ReactNode;
}
export declare namespace LabelableProvider {
  type State = LabelableProviderState;
  type Props = LabelableProviderProps;
}