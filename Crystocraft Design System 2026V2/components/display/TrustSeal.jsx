import React from 'react';

const SEAL_TEXT = {
  authentication: '· GENUINE CRYSTOCRAFT CRYSTAL · DAZZLE CUT · 32 FACETS ·',
  origin:         '· BOHEMIAN CRYSTAL · MADE TO STANDARD · CRYSTOCRAFT ·',
  heritage:       '· CRAFTED SINCE 1958 · CRYSTOCRAFT · EST · 1958 ·',
  dazzle:         '· DAZZLE CRYSTAL CUT™ · 32 FACETS · PROPRIETARY ·',
  smooth:         '· SMOOTH-SPIN™ · PATENTED · CRYSTOCRAFT ·',
};

const SEAL_CENTER = {
  authentication: ['DAZZLE', 'CUT'],
  origin:         ['ORIGIN', 'SEAL'],
  heritage:       ['EST', '1958'],
  dazzle:         ['32', 'FACETS'],
  smooth:         ['SMOOTH', 'SPIN'],
};

export function TrustSeal({
  variant = 'authentication',
  size = 120,
  color = 'currentColor',
  showMark = true,
  markSrc,
}) {
  const text = SEAL_TEXT[variant] || SEAL_TEXT.authentication;
  const center = SEAL_CENTER[variant] || SEAL_CENTER.authentication;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter  = size * 0.455;
  const rText   = size * 0.400;
  const rInner  = size * 0.295;
  const rMark   = size * 0.190;
  const fSize   = size * 0.062;
  const pathId  = `tsp-${variant}-${Math.round(size)}`;

  // Two-arc full circle starting at leftmost point
  const path = `M ${cx - rText},${cy} a ${rText},${rText} 0 1,1 ${rText * 2},0 a ${rText},${rText} 0 1,1 -${rText * 2},0`;

  const markPath = markSrc || '../../assets/logos/logo-mark.png';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ color, display: 'block' }}>
      <defs>
        <path id={pathId} d={path} />
      </defs>

      {/* Outer double ring */}
      <circle cx={cx} cy={cy} r={rOuter}        fill="none" stroke="currentColor" strokeWidth={size * 0.010} />
      <circle cx={cx} cy={cy} r={rOuter * 0.935} fill="none" stroke="currentColor" strokeWidth={size * 0.004} />

      {/* Inner ring */}
      <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="currentColor" strokeWidth={size * 0.004} />

      {/* Circular text — starts at leftmost pt, startOffset 25% = top centre */}
      <text
        fontFamily="'Work Sans', sans-serif"
        fontSize={fSize}
        fontWeight="500"
        letterSpacing={size * 0.009}
        fill="currentColor"
        textAnchor="middle"
      >
        <textPath href={`#${pathId}`} startOffset="25%">
          {text}
        </textPath>
      </text>

      {/* Centre mark — butterfly PNG if available */}
      {showMark ? (
        <image
          x={cx - rMark} y={cy - rMark}
          width={rMark * 2} height={rMark * 2}
          href={markPath}
          preserveAspectRatio="xMidYMid meet"
          style={{ filter: 'saturate(0) contrast(1.2)' }}
        />
      ) : (
        center.map((line, i) => (
          <text
            key={i}
            x={cx}
            y={cy + (i - (center.length - 1) / 2) * size * 0.115}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="'Work Sans', sans-serif"
            fontSize={size * 0.092}
            fontWeight="600"
            letterSpacing={size * 0.004}
            fill="currentColor"
          >
            {line}
          </text>
        ))
      )}

      {/* Decorative rule beneath centre */}
      <line
        x1={cx - rInner * 0.55} y1={cy + rInner * 0.62}
        x2={cx + rInner * 0.55} y2={cy + rInner * 0.62}
        stroke="currentColor" strokeWidth={size * 0.004}
      />
    </svg>
  );
}
