/* @ds-bundle: {"format":3,"namespace":"CrystocraftDesignSystem_25701b","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Divider","sourcePath":"components/core/Divider.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"TrustSeal","sourcePath":"components/display/TrustSeal.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"e8859cfebc34","components/core/Button.jsx":"c18be7416764","components/core/Divider.jsx":"e26648d4ae08","components/core/Tag.jsx":"2cd686dfcd3a","components/display/Card.jsx":"6e745d57c0ea","components/display/TrustSeal.jsx":"9d37360d7d70","components/forms/Input.jsx":"ebc3ca477b9d","components/forms/Select.jsx":"0d43699a87a7"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CrystocraftDesignSystem_25701b = window.CrystocraftDesignSystem_25701b || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
    el.id = _id;
    el.textContent = _S;
    document.head.appendChild(el);
  }
}
function Badge({
  children,
  variant = 'default',
  size = 'sm',
  className = '',
  ...rest
}) {
  const cls = ['crysto-badge', `crysto-badge--${variant}`, `crysto-badge--${size}`, className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
    el.id = _id;
    el.textContent = _S;
    document.head.appendChild(el);
  }
}
function Button({
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
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      className: cls
    }, rest), children);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Divider.jsx
try { (() => {
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
    el.id = _id;
    el.textContent = _S;
    document.head.appendChild(el);
  }
}
function Divider({
  label,
  variant = 'default',
  className = ''
}) {
  const cls = ['crysto-divider', variant !== 'default' ? `crysto-divider--${variant}` : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", {
    className: cls,
    role: "separator"
  }, /*#__PURE__*/React.createElement("div", {
    className: "crysto-divider__line"
  }), label && /*#__PURE__*/React.createElement("span", {
    className: "crysto-divider__label"
  }, label), label && /*#__PURE__*/React.createElement("div", {
    className: "crysto-divider__line"
  }));
}
Object.assign(__ds_scope, { Divider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Divider.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
    el.id = _id;
    el.textContent = _S;
    document.head.appendChild(el);
  }
}
function Tag({
  children,
  variant = 'default',
  active = false,
  onClick,
  className = '',
  ...rest
}) {
  const isClickable = !!onClick;
  const cls = ['crysto-tag', variant !== 'default' ? `crysto-tag--${variant}` : '', active ? 'crysto-tag--active' : '', isClickable && !active ? 'crysto-tag--clickable' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls,
    onClick: onClick,
    role: onClick ? 'button' : undefined,
    tabIndex: onClick ? 0 : undefined
  }, rest), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
    el.id = _id;
    el.textContent = _S;
    document.head.appendChild(el);
  }
}
function Card({
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
  const cls = ['crysto-card', `crysto-card--p-${padding}`, variant !== 'default' ? `crysto-card--${variant}` : '', hoverable ? 'crysto-card--hoverable' : '', radius !== 'none' ? `crysto-card--radius-${radius}` : '', flat ? 'crysto-card--flat' : '', borderless ? 'crysto-card--borderless' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    style: style,
    onClick: onClick
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/TrustSeal.jsx
try { (() => {
const SEAL_TEXT = {
  authentication: '· GENUINE CRYSTOCRAFT CRYSTAL · DAZZLE CUT · 32 FACETS ·',
  origin: '· BOHEMIAN CRYSTAL · MADE TO STANDARD · CRYSTOCRAFT ·',
  heritage: '· CRAFTED SINCE 1958 · CRYSTOCRAFT · EST · 1958 ·',
  dazzle: '· DAZZLE CRYSTAL CUT™ · 32 FACETS · PROPRIETARY ·',
  smooth: '· SMOOTH-SPIN™ · PATENTED · CRYSTOCRAFT ·'
};
const SEAL_CENTER = {
  authentication: ['DAZZLE', 'CUT'],
  origin: ['ORIGIN', 'SEAL'],
  heritage: ['EST', '1958'],
  dazzle: ['32', 'FACETS'],
  smooth: ['SMOOTH', 'SPIN']
};
function TrustSeal({
  variant = 'authentication',
  size = 120,
  color = 'currentColor',
  showMark = true,
  markSrc
}) {
  const text = SEAL_TEXT[variant] || SEAL_TEXT.authentication;
  const center = SEAL_CENTER[variant] || SEAL_CENTER.authentication;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.455;
  const rText = size * 0.400;
  const rInner = size * 0.295;
  const rMark = size * 0.190;
  const fSize = size * 0.062;
  const pathId = `tsp-${variant}-${Math.round(size)}`;

  // Two-arc full circle starting at leftmost point
  const path = `M ${cx - rText},${cy} a ${rText},${rText} 0 1,1 ${rText * 2},0 a ${rText},${rText} 0 1,1 -${rText * 2},0`;
  const markPath = markSrc || '../../assets/logos/logo-mark.png';
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    style: {
      color,
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("path", {
    id: pathId,
    d: path
  })), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: rOuter,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: size * 0.010
  }), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: rOuter * 0.935,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: size * 0.004
  }), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: rInner,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: size * 0.004
  }), /*#__PURE__*/React.createElement("text", {
    fontFamily: "'Work Sans', sans-serif",
    fontSize: fSize,
    fontWeight: "500",
    letterSpacing: size * 0.009,
    fill: "currentColor",
    textAnchor: "middle"
  }, /*#__PURE__*/React.createElement("textPath", {
    href: `#${pathId}`,
    startOffset: "25%"
  }, text)), showMark ? /*#__PURE__*/React.createElement("image", {
    x: cx - rMark,
    y: cy - rMark,
    width: rMark * 2,
    height: rMark * 2,
    href: markPath,
    preserveAspectRatio: "xMidYMid meet",
    style: {
      filter: 'saturate(0) contrast(1.2)'
    }
  }) : center.map((line, i) => /*#__PURE__*/React.createElement("text", {
    key: i,
    x: cx,
    y: cy + (i - (center.length - 1) / 2) * size * 0.115,
    textAnchor: "middle",
    dominantBaseline: "middle",
    fontFamily: "'Work Sans', sans-serif",
    fontSize: size * 0.092,
    fontWeight: "600",
    letterSpacing: size * 0.004,
    fill: "currentColor"
  }, line)), /*#__PURE__*/React.createElement("line", {
    x1: cx - rInner * 0.55,
    y1: cy + rInner * 0.62,
    x2: cx + rInner * 0.55,
    y2: cy + rInner * 0.62,
    stroke: "currentColor",
    strokeWidth: size * 0.004
  }));
}
Object.assign(__ds_scope, { TrustSeal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/TrustSeal.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
    el.id = _id;
    el.textContent = _S;
    document.head.appendChild(el);
  }
}
function Input({
  label,
  placeholder,
  value,
  defaultValue,
  onChange,
  type = 'text',
  error,
  hint,
  disabled = false,
  variant = 'underline',
  id,
  name,
  required,
  ...rest
}) {
  const fieldId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const cls = ['crysto-field', error ? 'crysto-field--error' : '', disabled ? 'crysto-field--disabled' : '', variant === 'boxed' ? 'crysto-field--boxed' : ''].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", {
    className: cls
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "crysto-field__label",
    htmlFor: fieldId
  }, label, required && /*#__PURE__*/React.createElement("span", {
    className: "crysto-field__req"
  }, "*")), /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    name: name,
    type: type,
    className: "crysto-field__input",
    placeholder: placeholder,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    required: required
  }, rest)), error && /*#__PURE__*/React.createElement("span", {
    className: "crysto-field__error"
  }, error), hint && !error && /*#__PURE__*/React.createElement("span", {
    className: "crysto-field__hint"
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
    el.id = _id;
    el.textContent = _S;
    document.head.appendChild(el);
  }
}
function Select({
  label,
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder,
  error,
  disabled = false,
  variant = 'underline',
  id,
  name,
  required,
  ...rest
}) {
  const fieldId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const cls = ['crysto-select-wrap', error ? 'crysto-select-wrap--error' : '', disabled ? 'crysto-select-wrap--disabled' : '', variant === 'boxed' ? 'crysto-select-wrap--boxed' : ''].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", {
    className: cls
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "crysto-field__label",
    htmlFor: fieldId
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "crysto-select-container"
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: fieldId,
    name: name,
    className: "crysto-select",
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    required: required
  }, rest), placeholder && /*#__PURE__*/React.createElement("option", {
    value: ""
  }, placeholder), options.map(opt => {
    const val = typeof opt === 'object' ? opt.value : opt;
    const lbl = typeof opt === 'object' ? opt.label : opt;
    return /*#__PURE__*/React.createElement("option", {
      key: val,
      value: val
    }, lbl);
  })), /*#__PURE__*/React.createElement("svg", {
    className: "crysto-select-arrow",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 6l4 4 4-4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), error && /*#__PURE__*/React.createElement("span", {
    className: "crysto-select__error"
  }, error));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Divider = __ds_scope.Divider;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.TrustSeal = __ds_scope.TrustSeal;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

})();
