import React from 'react';

export type SelectOption = string | { value: string; label: string };

export interface SelectProps {
  /** Field label */
  label?: string;
  /** Options array — strings or { value, label } objects */
  options?: SelectOption[];
  /** Controlled value */
  value?: string;
  /** Uncontrolled default */
  defaultValue?: string;
  /** onChange handler */
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Empty/placeholder option label */
  placeholder?: string;
  /** Error message */
  error?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Layout variant */
  variant?: 'underline' | 'boxed';
  /** Explicit id */
  id?: string;
  /** Form field name */
  name?: string;
  /** Required field */
  required?: boolean;
}

export declare function Select(props: SelectProps): JSX.Element;
