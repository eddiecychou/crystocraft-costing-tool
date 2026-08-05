import React from 'react';

export interface InputProps {
  /** Field label — also generates the htmlFor id */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Controlled value */
  value?: string;
  /** Uncontrolled default */
  defaultValue?: string;
  /** onChange handler */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** HTML input type */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
  /** Error message — shown in red, replaces hint */
  error?: string;
  /** Helper hint text — shown grey below input */
  hint?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Layout variant — underline (default, premium feel) or boxed */
  variant?: 'underline' | 'boxed';
  /** Explicit id override */
  id?: string;
  /** Form field name */
  name?: string;
  /** Required field marker */
  required?: boolean;
}

export declare function Input(props: InputProps): JSX.Element;
