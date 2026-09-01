SVG circular authentication seal with the butterfly mark at centre. Monochrome by default (survives engraving, embossing, one-colour print). Used on hangtags, packaging, product pages, and proposal documents.

```jsx
<TrustSeal variant="authentication" size={120} />
<TrustSeal variant="heritage" size={96} />
<TrustSeal variant="origin" size={80} />
<TrustSeal variant="dazzle" size={80} color="var(--color-gold)" />
<TrustSeal variant="smooth" size={80} />
<TrustSeal variant="authentication" size={120} showMark={false} />
```

Variants:
- `authentication` — GENUINE CRYSTOCRAFT CRYSTAL · DAZZLE CUT · 32 FACETS
- `origin`         — BOHEMIAN CRYSTAL · MADE TO STANDARD
- `heritage`       — CRAFTED SINCE 1958 · CRYSTOCRAFT
- `dazzle`         — DAZZLE CRYSTAL CUT™ · 32 FACETS (use `color="var(--color-gold)"`)
- `smooth`         — SMOOTH-SPIN™ · PATENTED

System rule: max one authentication seal + one heritage seal per item. Never crowd.
