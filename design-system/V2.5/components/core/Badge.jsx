import React from 'react';

const _S = `
.crysto-badge {
  display: inline-flex; align-items: center;
  font-family: var(--font-label);
  font-weight: var(--font-medium);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  line-height: 1;
  border: 1px solid transparent;
  border-radius: var(--radius-none);
}
.crysto-badge--xs { font-size: var(--text-2xs); padding: 3px 7px; }
.crysto-badge--sm { font-size: var(--text-xs);  padding: 4px 9px; }
.crysto-badge--md { font-size: var(--text-xs);  padding: 5px 11px; }

.crysto-badge--default    { background: var(--color-ink-05);  color: var(--color-ink);       border-color: var(--color-ink-12); }
.crysto-badge--gifts      { background: var(--color-gold-pale); color: var(--color-gold-dark); border-color: rgba(153,102,50,0.30); }
.crysto-badge--crystals   { background: var(--color-crystals-pale); color: var(--color-crystals); border-color: rgba(28,79,100,0.25); }
.crysto-badge--bespoke    { background: var(--color-bespoke-pale);  color: var(--color-bespoke);  border-color: rgba(110,36,51,0.25); }
.crysto-badge--solid-ink  { background: var(--color-ink);   color: var(--color-ivory); border-color: var(--color-ink); }
.crysto-badge--solid-gold { background: var(--color-gold);  color: var(--color-ink);   border-color: var(--color-gold); }
.crysto-badge--platinum   { background: rgba(201,203,204,0.22); color: var(--color-ink-80); border-color: var(--color-platinum); }
.crysto-badge--new        { background: var(--color-ink); color: var(--color-gold); border-color: var(--color-ink); }
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-badge-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function Badge({ children, variant = 'default', size = 'sm', className = '', ...rest }) {
  const cls = ['crysto-badge', `crysto-badge--${variant}`, `crysto-badge--${size}`, className].filter(Boolean).join(' ');
  return <span className={cls} {...rest}>{children}</span>;
}
