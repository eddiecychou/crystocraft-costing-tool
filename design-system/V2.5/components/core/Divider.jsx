import React from 'react';

const _S = `
.crysto-divider {
  display: flex; align-items: center;
  gap: var(--space-4); width: 100%;
}
.crysto-divider__line {
  flex: 1; height: 1px;
  background: var(--color-border-mid);
}
.crysto-divider__label {
  font-family: var(--font-label);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  letter-spacing: var(--tracking-ultra);
  text-transform: uppercase;
  color: var(--color-text-secondary);
  white-space: nowrap; flex-shrink: 0;
}
.crysto-divider--gold .crysto-divider__line  { background: var(--color-gold); opacity: 0.45; }
.crysto-divider--gold .crysto-divider__label { color: var(--color-gold-dark); }
.crysto-divider--bold .crysto-divider__line  { background: var(--color-ink); opacity: 1; }
.crysto-divider--subtle .crysto-divider__line{ background: var(--color-border); }
.crysto-divider--on-dark .crysto-divider__line { background: rgba(247,244,239,0.2); }
.crysto-divider--on-dark .crysto-divider__label{ color: rgba(247,244,239,0.5); }
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-divider-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function Divider({ label, variant = 'default', className = '' }) {
  const cls = ['crysto-divider', variant !== 'default' ? `crysto-divider--${variant}` : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} role="separator">
      <div className="crysto-divider__line" />
      {label && <span className="crysto-divider__label">{label}</span>}
      {label && <div className="crysto-divider__line" />}
    </div>
  );
}
