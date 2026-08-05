import React from 'react';

export interface ButtonProps {
  /** Button label or content */
  children: React.ReactNode;
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'outline-gold' | 'reversed' | 'sapphire' | 'burgundy';
  /** Size */
  size?: 'sm' | 'md' | 'lg';
  /** Disabled state — reduces opacity to 0.42, blocks interaction */
  disabled?: boolean;
  /** Stretch to full container width */
  fullWidth?: boolean;
  /** Click handler */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** HTML button type */
  type?: 'button' | 'submit' | 'reset';
  /** Render as an anchor tag */
  href?: string;
  /** Extra CSS class names */
  className?: string;
}

export declare function Button(props: ButtonProps): JSX.Element;
