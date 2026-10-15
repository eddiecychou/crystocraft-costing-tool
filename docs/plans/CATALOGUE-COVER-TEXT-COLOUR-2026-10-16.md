# Curated catalogue cover text contrast — 16 October 2026

Owner supplied the Manulife VIP Drinkware Gifts PDF and cover-editor/print screenshots, and requested a white/black text choice instead of faded coloured season/tagline/divider.

## Cause

`CataloguePreview.jsx` hardcoded season and divider to gold at 30% opacity, tagline to white at 55%, and title/logo to white. The editor offered only photo-overlay colour/opacity and a generic Preview label, so it could not control or preview text contrast.

## Local implementation

- New independent Cover text colour White/Black buttons save `cover_text_color` on the catalogue. Missing/invalid legacy values default to white.
- Shared `CatalogueCover.jsx` renders the actual editor thumbnail and print/PDF cover. Title, season/period, tagline, logo and divider follow the selected pure white or black; no gold/alpha fade for cover text or divider.
- The overlay remains a separate control affecting the photo only. Without a photo the solid background contrasts with the chosen ink.
- The title uses the same bundled Questrial font in both contexts. Existing product-page styling and catalogue content are unchanged.
- The preview uses the catalogue's actual title/season/tagline. Existing Save Changes/Create Catalogue process persists the choice. No production catalogue settings or business data were edited during development.

## Verification — PASS locally

- Production build passed; 130 tests, zero failures (124 existing + six cover tests).
- Six real-component tests cover solid white/black editor and print rendering, legacy/invalid fallback, save/reload and preserved overlay/content, creation default, no-photo contrast and optional blank text.
- New suite included in prebuild and GitHub Actions. No-undefined lint and whitespace checks passed.
- Local browser fixture used the actual form and print components with an image extracted from the user-supplied cover PDF. White text/dark overlay and black text/light overlay were visually checked. DOM computed styles for title, season, tagline and divider were respectively RGB 255/255/255 or 0/0/0, opacity 1. Browser runtime errors: none.
- Evidence: `/private/tmp/v818-evidence/catalogue-cover-editor-white.png`, `catalogue-cover-editor-black.png`, `catalogue-cover-print-white.png`, `catalogue-cover-print-black.png`.
- Local fixture served at http://127.0.0.1:5192 and confirmed HTTP 200; stopped after verification.

Not pushed or deployed. No new production PDF export or release login checks performed for this change. The previously prepared commercial-document naming fixes remain a separate local commit underneath this one.
