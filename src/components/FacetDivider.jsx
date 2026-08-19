// V2.5 design system — hairline separator with a small diamond glyph,
// the preferred divider between major sections (replacing bare vertical
// spacing). See .facet-divider / .facet-divider-glyph in index.css.
export default function FacetDivider() {
  return (
    <div className="facet-divider" aria-hidden="true">
      <span className="facet-divider-glyph" />
    </div>
  )
}
