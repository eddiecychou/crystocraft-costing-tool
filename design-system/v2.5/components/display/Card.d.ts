import React from 'react';

export interface CardProps {
  /** Card content */
  children: React.ReactNode;
  /** Background variant */
  variant?: 'default' | 'ivory' | 'dark';
  /** Inner padding */
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  /** Lift animation on hover */
  hoverable?: boolean;
  /** Border radius — none (default, square) or xs/sm/md */
  radius?: 'none' | 'xs' | 'sm' | 'md';
  /** Remove box-shadow */
  flat?: boolean;
  /** Remove border */
  borderless?: boolean;
  /** Extra CSS class names */
  className?: string;
  /** Inline style overrides */
  style?: React.CSSProperties;
  /** Click handler */
  onClick?: () => void;
}

export declare function Card(props: CardProps): JSX.Element;
