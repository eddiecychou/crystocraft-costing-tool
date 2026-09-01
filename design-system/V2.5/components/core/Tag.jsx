import React from 'react';

const _S = `
.crysto-tag {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--font-label);
  font-size: var(--text-xs);
  font-weight: var(--font-regular);
  letter-spacing: var(--tracking-wide);
  line-height: 1;
  padding: 5px 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  background: transparent;
  cursor: default;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
}
.crysto-tag--filled  { background: var(--color-ink-05); }
.crysto-tag--gold    { border-color: rgba(153,102,50,0.45); color: var(--color-gold-dark); background: var(--color-gold-pale); }
.crysto-tag--sapphire{ border-color: rgba(28,79,100,0.35); color: var(--color-crystals);  background: var(--color-crystals-pale); }
.crysto-tag--burgundy{ border-color: rgba(110,36,51,0.35); color: var(--color-bespoke);   background: var(--color-bespoke-pale); }
.crysto-tag--dark    { background: var(--color-ink-95); color: var(--color-ivory); border-color: var(--color-ink-95); }
.crysto-tag--clickable       { cursor: pointer; }
.crysto-tag--clickable:hover { background: var(--color-ink-08); color: var(--color-ink); border-color: var(--color-ink-20); }
.crysto-tag--active  { background: var(--color-ink); color: var(--color-ivory); border-color: var(--color-ink); cursor: pointer; }
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-tag-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function Tag({ children, variant = 'default', active = false, onClick, className = '', ...rest }) {
  const isClickable = !!onClick;
  const cls = [
    'crysto-tag',
    variant !== 'default' ? `crysto-tag--${variant}` : '',
    active ? 'crysto-tag--active' : '',
    isClickable && !active ? 'crysto-tag--clickable' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <span className={cls} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} {...rest}>
      {children}
    </span>
  );
}
