import React from 'react';

const _S = `
.crysto-field {
  display: flex; flex-direction: column;
  gap: var(--space-2); width: 100%;
}
.crysto-field__label {
  font-family: var(--font-label);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  letter-spacing: var(--tracking-ultra);
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.crysto-field__req { color: var(--color-gold-dark); margin-left: 2px; }

/* Underline variant (default) */
.crysto-field__input {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-regular);
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border-mid);
  padding: var(--space-3) 0;
  outline: none; width: 100%;
  transition: border-color 0.18s ease;
  border-radius: 0;
}
.crysto-field__input::placeholder { color: var(--color-graphite); opacity: 0.55; }
.crysto-field__input:focus { border-bottom-color: var(--color-ink); }

/* Boxed variant */
.crysto-field--boxed .crysto-field__input {
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-xs);
  padding: var(--space-3) var(--space-4);
  background: var(--color-white);
}
.crysto-field--boxed .crysto-field__input:focus { border-color: var(--color-ink); }

.crysto-field--error .crysto-field__input        { border-color: var(--color-error) !important; }
.crysto-field--disabled .crysto-field__input      { opacity: 0.42; cursor: not-allowed; }
.crysto-field__error {
  font-family: var(--font-label); font-size: var(--text-xs);
  color: var(--color-error); letter-spacing: var(--tracking-wide);
}
.crysto-field__hint {
  font-family: var(--font-label); font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
`;

if (typeof document !== 'undefined') {
  const _id = 'crysto-input-styles';
  if (!document.getElementById(_id)) {
    const el = document.createElement('style');
    el.id = _id; el.textContent = _S;
    document.head.appendChild(el);
  }
}

export function Input({
  label, placeholder, value, defaultValue, onChange,
  type = 'text', error, hint, disabled = false,
  variant = 'underline', id, name, required, ...rest
}) {
  const fieldId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const cls = [
    'crysto-field',
    error ? 'crysto-field--error' : '',
    disabled ? 'crysto-field--disabled' : '',
    variant === 'boxed' ? 'crysto-field--boxed' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {label && (
        <label className="crysto-field__label" htmlFor={fieldId}>
          {label}{required && <span className="crysto-field__req">*</span>}
        </label>
      )}
      <input
        id={fieldId} name={name} type={type}
        className="crysto-field__input"
        placeholder={placeholder}
        value={value} defaultValue={defaultValue}
        onChange={onChange} disabled={disabled} required={required}
        {...rest}
      />
      {error  && <span className="crysto-field__error">{error}</span>}
      {hint && !error && <span className="crysto-field__hint">{hint}</span>}
    </div>
  );
}
