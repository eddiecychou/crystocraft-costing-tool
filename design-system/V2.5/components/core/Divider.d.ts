import React from 'react';

export interface DividerProps {
  /** Optional centred label text */
  label?: string;
  /** Visual variant */
  variant?: 'default' | 'gold' | 'bold' | 'subtle' | 'on-dark';
  /** Extra CSS class names */
  className?: string;
}

export declare function Divider(props: DividerProps): JSX.Element;
