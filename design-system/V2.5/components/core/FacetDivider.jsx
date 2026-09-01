import React from 'react';

const _S = `
.crysto-facet-divider { display: flex; align-items: center; gap: var(--space-3); width: 100%; }
.crysto-facet-divider__line { flex: 1; height: 1px; background: var(--color-border-mid); }
.crysto-facet-divider__glyph { flex-shrink: 0; opacity: 0.7; }
.crysto-facet-divider--gifts .crysto-facet-divider__glyph { color: var(--color-bronze); }
.crysto-facet-divider--crystals .crysto-facet-divider__glyph { color: var(--color-crystals); }
.crysto-facet-divider--bespoke .crysto-facet-divider__glyph { color: var(--color-bespoke); }
.crysto-facet-divider--on-dark .crysto-facet-divider__line { background: rgba(247,238,227,0.2); }
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-facet-divider-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function FacetDivider({ variant = 'gifts', onDark = false, className = '' }) {
  const cls = ['crysto-facet-divider', `crysto-facet-divider--${variant}`, onDark ? 'crysto-facet-divider--on-dark' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} role="separator">
      <div className="crysto-facet-divider__line" />
      <svg className="crysto-facet-divider__glyph" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 0.5 L11 5 L7 13.5 L3 5 Z" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M3 5 L11 5 M7 0.5 L7 13.5" stroke="currentColor" strokeWidth="0.6" opacity="0.55" />
      </svg>
      <div className="crysto-facet-divider__line" />
    </div>
  );
}
