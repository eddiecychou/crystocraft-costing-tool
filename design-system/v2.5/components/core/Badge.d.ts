import React from 'react';

export interface BadgeProps {
  /** Badge label */
  children: React.ReactNode;
  /** Visual variant */
  variant?: 'default' | 'gifts' | 'crystals' | 'bespoke' | 'solid-ink' | 'solid-gold' | 'platinum' | 'new';
  /** Size */
  size?: 'xs' | 'sm' | 'md';
  /** Extra CSS class names */
  className?: string;
}

export declare function Badge(props: BadgeProps): JSX.Element;
