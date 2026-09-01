import React from 'react';

const _S = `
.crysto-craftnote { display: flex; align-items: flex-start; gap: 10px; max-width: 260px; }
.crysto-craftnote__pin { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; border: 1px solid currentColor; margin-top: 6px; opacity: 0.7; }
.crysto-craftnote__body { display: flex; flex-direction: column; gap: 2px; }
.crysto-craftnote__label { font-family: var(--font-label); font-size: 9px; font-weight: 500; letter-spacing: var(--tracking-wider); text-transform: uppercase; opacity: 0.6; }
.crysto-craftnote__text { font-family: var(--font-label); font-size: 12px; line-height: 1.5; color: var(--color-text-secondary); }
.crysto-craftnote--gifts { color: var(--color-bronze); }
.crysto-craftnote--crystals { color: var(--color-crystals); }
.crysto-craftnote--bespoke { color: var(--color-bespoke); }
.crysto-craftnote--on-dark .crysto-craftnote__text { color: rgba(247,238,227,0.65); }
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-craftnote-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function CraftNote({ label = 'Atelier Note', children, variant = 'gifts', onDark = false, className = '' }) {
  const cls = ['crysto-craftnote', `crysto-craftnote--${variant}`, onDark ? 'crysto-craftnote--on-dark' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="crysto-craftnote__pin" />
      <div className="crysto-craftnote__body">
        <span className="crysto-craftnote__label">{label}</span>
        <span className="crysto-craftnote__text">{children}</span>
      </div>
    </div>
  );
}
