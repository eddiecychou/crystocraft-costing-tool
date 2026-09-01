import React from 'react';

export interface CraftNoteProps {
  /** Small uppercase label above the note, e.g. "Atelier Note", "Materials", "Finish" */
  label?: string;
  /** The annotation copy itself — a short craft/process detail */
  children?: React.ReactNode;
  /** Division accent for the pin marker */
  variant?: 'gifts' | 'crystals' | 'bespoke';
  onDark?: boolean;
  className?: string;
}

/** Margin annotation styled after a maker's process note — a pin marker plus a short label + line, for calling out material, technique, or provenance details next to imagery. Use sparingly, one or two per page. */
export declare function CraftNote(props: CraftNoteProps): JSX.Element;
