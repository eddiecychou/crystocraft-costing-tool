import React from 'react';

const _S = `
.crysto-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--space-2);
  font-family: var(--font-label);
  font-weight: var(--font-medium);
  letter-spacing: var(--tracking-ultra);
  text-transform: uppercase;
  text-decoration: none;
  border: 1px solid transparent;
  border-radius: var(--radius-none);
  cursor: pointer; outline: none;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, opacity 0.18s ease, transform 0.12s ease;
  white-space: nowrap; user-select: none; vertical-align: middle;
}
.crysto-btn:active:not(:disabled) { transform: scale(0.98); }
.crysto-btn:disabled { opacity: 0.42; cursor: not-allowed; pointer-events: none; }
.crysto-btn--full { width: 100%; }

.crysto-btn--sm  { padding: 7px 18px;  font-size: var(--text-xs); }
.crysto-btn--md  { padding: 11px 28px; font-size: var(--text-sm); }
.crysto-btn--lg  { padding: 15px 36px; font-size: var(--text-base); }

.crysto-btn--primary      { background: var(--color-ink);   color: var(--color-ivory);  border-color: var(--color-ink); }
.crysto-btn--primary:hover{ background: var(--color-ink-95); border-color: var(--color-ink-95); }

.crysto-btn--secondary      { background: var(--color-gold);      color: var(--color-ink); border-color: var(--color-gold); }
.crysto-btn--secondary:hover{ background: var(--color-gold-dark); border-color: var(--color-gold-dark); }

.crysto-btn--ghost      { background: transparent; color: var(--color-ink); border-color: transparent; }
.crysto-btn--ghost:hover{ background: var(--color-ink-05); }

.crysto-btn--outline      { background: transparent; color: var(--color-ink); border-color: var(--color-ink); }
.crysto-btn--outline:hover{ background: var(--color-ink); color: var(--color-ivory); }

.crysto-btn--outline-gold      { background: transparent; color: var(--color-gold-dark); border-color: var(--color-gold); }
.crysto-btn--outline-gold:hover{ background: var(--color-gold); color: var(--color-ink); }

.crysto-btn--reversed      { background: var(--color-ivory); color: var(--color-ink); border-color: var(--color-ivory); }
.crysto-btn--reversed:hover{ background: var(--color-ivory-mid); border-color: var(--color-ivory-mid); }

.crysto-btn--sapphire      { background: var(--color-crystals);      color: var(--color-white); border-color: var(--color-crystals); }
.crysto-btn--sapphire:hover{ background: var(--color-crystals-dark); border-color: var(--color-crystals-dark); }

.crysto-btn--burgundy      { background: var(--color-bespoke);      color: var(--color-white); border-color: var(--color-bespoke); }
.crysto-btn--burgundy:hover{ background: var(--color-bespoke-dark); border-color: var(--color-bespoke-dark); }
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-btn-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  onClick,
  type = 'button',
  href,
  className = '',
  ...rest
}) {
  const cls = ['crysto-btn', `crysto-btn--${variant}`, `crysto-btn--${size}`, fullWidth && 'crysto-btn--full', className].filter(Boolean).join(' ');
  if (href) {
    return <a href={href} className={cls} {...rest}>{children}</a>;
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={cls} {...rest}>
      {children}
    </button>
  );
}
