# Cover text colour and document catalogue labels — release verification

Owner explicitly authorized push and deployment after reviewing the local cover feature.
Release commit: `c305540355228fff9a782869b7afc62aa94e9179`.
Also includes previously prepared commercial-document naming commit `178f074a`.

Scope: independent white/black cover text saved per curated catalogue; shared editor/print cover, opaque title/season/tagline/logo/divider and local title font. Commercial editors use Crystocraft Range; old quote fallback category aliases normalize only in display/new choices. Existing business records are not migrated.

Preparation: clean managed worktree, latest main checked, two local commits ahead and no divergence. Production build and 130 regression tests passed with zero failures. Login configuration tests 11/11, no-undefined lint and whitespace checks passed. No Firebase rules changes.

Candidate `6ad0f26936dbc8ccfb78e9dc`: PASS. Fresh admin sign-in reached Dashboard (one initial transient connection error, retry succeeded), full range catalogue 294/294 products and 713 SKUs loaded and survived refresh. Cover form loaded Manulife catalogue; Black selection rendered title/season/divider rgb(0,0,0), opacity 1. Cancelled without saving. Fresh approved customer sign-in reached QA-only company /shop, 24 range cards loaded after refresh, /settings redirected to /shop with no Settings link, browser errors empty. Explicit sign-out completed for both roles. Screenshots: /private/tmp/v818-evidence/cover-candidate-{admin,black,customer}.png.

Pushed c3055403 to origin/main. Production deploy `6ad0f3b9a318f584b4dc5f04` and GitHub Actions run `38762274623` completed successfully. Production published 16 October 2026 02:40:38 AEDT. Both portal.crystocraft.com and ua-product-manager.netlify.app serve `/assets/index-DKCvngYy.js`, Firebase configuration probe HTTP 200. Build marker V8.18 · 16 Oct, 02:40. No Firebase rules deployed.

Production admin PASS: fresh email/password sign-in as claude-qa@crystocraft.com reached /dashboard, Settings/Portal present, full range catalogue 294/294 products and 713 SKUs survived refresh. First attempt had a transient connection failure; one retry succeeded without account/config changes. Manulife print preview rendered solid white title/season/divider with opacity 1; photo loaded and screenshot visually inspected. Editor exposes White/Black controls and Black preview works; cancelled without saving catalogue data. Browser error log empty. Explicit sign-out completed.

Production customer PASS: fresh email/password sign-in as customer-qa@crystocraft.com reached /shop with approved QA-only company. /shop/figurine loaded 24 cards and survived refresh; Sacred Angel detail loaded with customer pricing. /settings redirected to /shop; no Settings/admin controls or internal cost/notes visible. Browser error log empty. Explicit sign-out completed. Owner working session untouched.

Candidate customer Sacred Angel detail also passed: pricing, ~9 weeks lead time, MOQ 100, no internal supplier cost fields.

Evidence: /private/tmp/v818-evidence/cover-production-{admin,print,black,customer}.png. White print screenshot visually inspected; black preview was an unsaved selection. No new PDF file was exported during production QA; print route and colour rendering were verified, and save/reload + both print colours covered by automated regression tests.

GitHub Actions run 38762274623 / job 116516373461 SUCCESS: search 39, quote PDF 10, quote Excel 7, invoice 23, packing/PO 20, AI writer 25, catalogue cover 6 = 130 passed, zero failures. Production verification completed ~02:44 AEDT.
