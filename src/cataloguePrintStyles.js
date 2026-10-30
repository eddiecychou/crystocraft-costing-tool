// Mounted by CataloguePreview only. Never import these print rules as global CSS.
export const catalogueCSS = `
/* A fixed A4 composition, scaled only for screen viewing. No clipping or text
   shrinking: CatalogueProductPages measures copy and creates extra pages. */
.catalogue-print-root { font-family: 'Catalogue Questrial', Questrial, sans-serif; color: #222; }
.catalogue-wrapper { background: #e9e8e6; padding: 24px 0; margin-top: 64px; }
.catalogue-sheet { position: relative; margin: 0 auto 16px; }
.catalogue-sheet > .catalogue-page { position: absolute; top: 0; left: 0; transform: scale(var(--catalogue-scale)); transform-origin: top left; }
.catalogue-page { width: 297mm; height: 210mm; box-sizing: border-box; background: white; }
.cat-page--portrait { width: 210mm; height: 297mm; }
.cat-page { display: grid; grid-template-rows: 40px minmax(0, 1fr) 24px; gap: 20px; padding: 28px 32px; }
.cat-page-header, .cat-page-footer { display: flex; justify-content: space-between; align-items: center; gap: 24px; color: #666; font-size: 12px; line-height: 1.3; }
.cat-page-header { border-bottom: 1px solid #e9e8e6; padding-bottom: 12px; }
.cat-page-header > img { width: 164px; height: 26px; object-fit: contain; }
.cat-page-header > span { text-align: right; overflow-wrap: anywhere; }
.cat-page-footer { border-top: 1px solid #e9e8e6; padding-top: 8px; font-size: 11px; }
.cat-page-body { min-width: 0; min-height: 0; }
.cat-products { display: grid; gap: 24px 32px; height: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cat-products--overview { grid-template-rows: repeat(2, minmax(0, 1fr)); }
.cat-product { min-width: 0; min-height: 0; }
.cat-product--overview { display: flex; align-items: flex-start; gap: 16px; }
.cat-product--overview > .cat-copy { flex: 1; min-width: 0; }
.cat-product--standard { display: flex; flex-direction: column; gap: 16px; }
.cat-gallery { min-width: 0; min-height: 0; }
.cat-gallery img, .cat-photo-grid img { display: block; width: 100%; height: 100%; object-fit: contain; }
.cat-main-frame, .cat-photo-cell { min-width: 0; min-height: 0; }
.cat-gallery--standard { display: flex; justify-content: center; align-items: center; gap: 12px; height: 320px; flex-shrink: 0; }
.cat-gallery--standard > .cat-main-frame { width: 320px; height: 320px; flex: 0 1 320px; }
.cat-gallery--overview { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 152px; flex-shrink: 0; }
.cat-gallery--overview > .cat-main-frame { width: 152px; height: 152px; }
.cat-single { height: 100%; min-width: 0; min-height: 0; }
.cat-single--feature { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 32px; }
.cat-gallery--feature { display: flex; flex-direction: column; gap: 16px; height: 100%; }
.cat-gallery--feature > .cat-main-frame { flex: 1; min-height: 0; }
.cat-single--details { width: 720px; max-width: 100%; margin: 0 auto; }
.cat-single--gallery, .cat-single--large, .cat-single--full { display: flex; flex-direction: column; gap: 24px; }
.cat-single--full { gap: 16px; }
.cat-photo-grid { flex: 1; min-height: 0; display: grid; gap: 24px; }
.cat-photo-grid--1 { grid-template-columns: 1fr; }
.cat-photo-grid--2, .cat-photo-grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cat-photo-grid--3, .cat-photo-grid--5, .cat-photo-grid--6 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cat-photo-grid--4, .cat-photo-grid--5, .cat-photo-grid--6 { grid-template-rows: repeat(2, minmax(0, 1fr)); }
.cat-copy { display: flow-root; flex-shrink: 0; font-family: 'Catalogue Questrial', Questrial, sans-serif; color: #222; overflow-wrap: anywhere; }
.cat-copy .cat-product-title { margin: 0 0 8px; padding: 0; font: 400 24px/1.2 'Catalogue Questrial', Questrial, sans-serif; text-transform: uppercase; letter-spacing: .04em; }
.cat-copy--standard .cat-product-title { font-size: 20px; }
.cat-copy--overview .cat-product-title { font-size: 16px; }
.cat-copy .cat-product-category { margin: 0 0 16px; font: 400 10px/1.4 'Catalogue Work Sans', sans-serif; text-transform: uppercase; letter-spacing: .12em; color: #666; }
.cat-copy .cat-continued { margin: 0 0 8px; font-size: 12px; line-height: 1.4; color: #6e2433; }
.cat-copy--full .cat-product-title { font-size: 16px; }
.cat-copy--full .cat-continued { font-size: 10px; margin-bottom: 4px; }
.cat-copy .cat-text-block { margin: 16px 0 0; }
.cat-copy .cat-copy-text { margin: 0; padding: 0; font: 400 14px/1.5 'Catalogue Questrial', Questrial, sans-serif; white-space: pre-wrap; }
.cat-tail-space { display: none; }
.cat-copy .cat-spec-label { margin: 0 0 8px; font: 400 10px/1.4 'Catalogue Work Sans', sans-serif; text-transform: uppercase; letter-spacing: .12em; color: #666; }
.cat-copy .cat-text-block--spec .cat-copy-text { font-size: 12px; line-height: 1.5; color: #666; }
.cat-copy--overview .cat-copy-text { font-size: 13px; }
.cat-copy--overview .cat-product-category, .cat-copy--overview .cat-text-block { margin-bottom: 0; margin-top: 8px; }
.cat-measure { position: absolute; left: -20000px; top: 0; visibility: hidden; pointer-events: none; }
.cat-layout-error { margin: 24px; color: #6e2433; }
.cat-print-notice { display: none; }
@media screen and (max-width: 639px) { .catalogue-wrapper { margin-top: 128px; } }
@media print {
  @page { size: A4 landscape; margin: 0; }
  @page oc-catalogue-landscape { size: A4 landscape; margin: 0; }
  @page oc-catalogue-portrait { size: A4 portrait; margin: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* Keep the document in the named page context; returning to an anonymous
     page after the last sheet makes Chromium append a blank page. */
  html, body { page: oc-catalogue-landscape; margin: 0 !important; padding: 0 !important; background: white !important; height: auto !important; overflow: visible !important; }
  /* The ending sheet can also be portrait. Keep its page context through
     the document end rather than adding an empty landscape page. */
  html:has(.catalogue-sheet--portrait.cat-last-sheet),
  body:has(.catalogue-sheet--portrait.cat-last-sheet) { page: oc-catalogue-portrait; }
  [data-print-shell] { display: block !important; height: auto !important; overflow: visible !important; }
  [data-print-hide], .no-print, .cat-measure { display: none !important; }
  [data-print-root] { display: block !important; overflow: visible !important; height: auto !important; padding: 0 !important; }
  .catalogue-wrapper { background: white !important; margin: 0 !important; padding: 0 !important; }
  .catalogue-sheet { page: oc-catalogue-landscape; width: 297mm !important; height: 210mm !important; margin: 0 !important; break-inside: avoid; break-after: page; }
  .catalogue-sheet--portrait { page: oc-catalogue-portrait; width: 210mm !important; height: 297mm !important; }
  .catalogue-sheet > .catalogue-page { position: relative; transform: none !important; margin: 0 !important; box-shadow: none !important; }
  .catalogue-sheet.cat-last-sheet { break-after: auto; }
  .cat-print-blocked .catalogue-sheet { display: none !important; }
  .cat-print-blocked .cat-print-notice { display: block; padding: 32px; }
}
`
