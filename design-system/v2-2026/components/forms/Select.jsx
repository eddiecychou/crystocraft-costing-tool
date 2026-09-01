import React from 'react';

const _S = `
.crysto-select-wrap {
  display: flex; flex-direction: column;
  gap: var(--space-2); width: 100%;
}
.crysto-select-wrap .crysto-field__label {
  font-family: var(--font-label);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  letter-spacing: var(--tracking-ultra);
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.crysto-select-container {
  position: relative; width: 100%;
}
.crysto-select {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-regular);
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border-mid);
  padding: var(--space-3) var(--space-8) var(--space-3) 0;
  outline: none; width: 100%;
  cursor: pointer; appearance: none;
  transition: border-color 0.18s ease;
  border-radius: 0;
}
.crysto-select:focus { border-bottom-color: var(--color-ink); }
.crysto-select-arrow {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; pointer-events: none;
  color: var(--color-graphite);
}
.crysto-select-wrap--boxed .crysto-select {
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-xs);
  padding: var(--space-3) var(--space-10) var(--space-3) var(--space-4);
  background: var(--color-white);
}
.crysto-select-wrap--boxed .crysto-select:focus { border-color: var(--color-ink); }
.crysto-select-wrap--boxed .crysto-select-arrow { right: var(--space-4); }
.crysto-select-wrap--error .crysto-select   { border-color: var(--color-error) !important; }
.crysto-select-wrap--disabled .crysto-select { opacity: 0.42; cursor: not-allowed; }
.crysto-select__error {
  font-family: var(--font-label); font-size: var(--text-xs);
  color: var(--color-error); letter-spacing: var(--tracking-wide);
}
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-select-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function Select({
  label, options = [], value, defaultValue, onChange,
  placeholder, error, disabled = false,
  variant = 'underline', id, name, required, ...rest
}) {
  const fieldId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const cls = [
    'crysto-select-wrap',
    error ? 'crysto-select-wrap--error' : '',
    disabled ? 'crysto-select-wrap--disabled' : '',
    variant === 'boxed' ? 'crysto-select-wrap--boxed' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {label && <label className="crysto-field__label" htmlFor={fieldId}>{label}</label>}
      <div className="crysto-select-container">
        <select
          id={fieldId} name={name} className="crysto-select"
          value={value} defaultValue={defaultValue}
          onChange={onChange} disabled={disabled} required={required} {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => {
            const val = typeof opt === 'object' ? opt.value : opt;
            const lbl = typeof opt === 'object' ? opt.label : opt;
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
        <svg className="crysto-select-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {error && <span className="crysto-select__error">{error}</span>}
    </div>
  );
}
