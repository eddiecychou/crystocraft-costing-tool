import React from 'react';

export interface TrustSealProps {
  /** Which seal to render */
  variant?: 'authentication' | 'origin' | 'heritage' | 'dazzle' | 'smooth';
  /** Diameter in px */
  size?: number;
  /** CSS colour value for the monochrome artwork */
  color?: string;
  /** Show the butterfly mark PNG in the centre */
  showMark?: boolean;
  /** Override path/URL for the mark image */
  markSrc?: string;
}

export declare function TrustSeal(props: TrustSealProps): JSX.Element;
