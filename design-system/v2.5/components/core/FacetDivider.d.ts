import React from 'react';

export interface FacetDividerProps {
  /** Division accent for the facet glyph */
  variant?: 'gifts' | 'crystals' | 'bespoke';
  /** Use light-on-dark line colour */
  onDark?: boolean;
  className?: string;
}

/** A restrained crystal-facet motif used in place of a plain hairline where a touch of craft detail is wanted — section breaks, proposal pages, editorial pull-breaks. Never decorative beyond this one glyph. */
export declare function FacetDivider(props: FacetDividerProps): JSX.Element;
