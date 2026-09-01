import React from 'react';

const _S = `
.crysto-card {
  background: var(--color-white);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-none);
  overflow: hidden; position: relative;
  transition: box-shadow 0.22s ease, transform 0.22s ease, border-color 0.22s ease;
}
.crysto-card--p-none { padding: 0; }
.crysto-card--p-sm   { padding: var(--space-4); }
.crysto-card--p-md   { padding: var(--space-6); }
.crysto-card--p-lg   { padding: var(--space-8); }
.crysto-card--p-xl   { padding: var(--space-12); }

.crysto-card--ivory  { background: var(--color-ivory); }
.crysto-card--dark   { background: var(--color-ink); color: var(--color-ivory); border-color: var(--color-ink-95); }
.crysto-card--flat   { box-shadow: none; }
.crysto-card--borderless { border-color: transparent; }

.crysto-card--radius-xs { border-radius: var(--radius-xs); }
.crysto-card--radius-sm { border-radius: var(--radius-sm); }
.crysto-card--radius-md { border-radius: var(--radius-md); }

.crysto-card--hoverable { cursor: pointer; }
.crysto-card--hoverable:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-ink-12);
  transform: translateY(-2px);
}
.crysto-card--hoverable:active { transform: scale(0.99); }
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-card-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function Card({
  children,
  variant = 'default',
  padding = 'md',
  hoverable = false,
  radius = 'none',
  flat = false,
  borderless = false,
  className = '',
  style,
  onClick,
  ...rest
}) {
  const cls = [
    'crysto-card',
    `crysto-card--p-${padding}`,
    variant !== 'default' ? `crysto-card--${variant}` : '',
    hoverable ? 'crysto-card--hoverable' : '',
    radius !== 'none' ? `crysto-card--radius-${radius}` : '',
    flat ? 'crysto-card--flat' : '',
    borderless ? 'crysto-card--borderless' : '',
    className,
  ].filter(Boolean).join(' ');
  return <div className={cls} style={style} onClick={onClick} {...rest}>{children}</div>;
}
