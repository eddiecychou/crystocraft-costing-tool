import React from 'react';

export interface TagProps {
  /** Tag label */
  children: React.ReactNode;
  /** Visual variant */
  variant?: 'default' | 'filled' | 'gold' | 'sapphire' | 'burgundy' | 'dark';
  /** Active/selected state — fills with ink */
  active?: boolean;
  /** Click handler — makes tag interactive (adds cursor pointer + hover state) */
  onClick?: () => void;
  /** Extra CSS class names */
  className?: string;
}

export declare function Tag(props: TagProps): JSX.Element;
