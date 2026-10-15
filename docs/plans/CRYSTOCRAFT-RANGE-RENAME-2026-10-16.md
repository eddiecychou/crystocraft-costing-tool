# Crystocraft Range catalogue rename — 16 October 2026

Owner requested renaming Figurine Gifts to Crystocraft Range, then explicitly authorized deployment and verification in both admin and customer views.

## Scope and preparation

Release commit: `bf6bdcf3a31d0d381324cba23917d0e2f7641a28`.
Updated desktop navigation, catalogue headings, customer homepage collection title/CTA, back links, catalogue-band selection, module access label, and related catalogue help text. Compact mobile navigation uses `Range`. Existing module keys, routes and product collections are preserved.

Production build passed with 115 regression tests, zero failures. Login configuration tests: 11 passed, zero failures. No-undefined lint and diff whitespace checks passed. No Firebase rules changes.

## Candidate — PASS

Deploy: `6ad0e77ddece0c2c7ab3c306`.
URL: https://6ad0e77ddece0c2c7ab3c306--ua-product-manager.netlify.app
Served bundle: `/assets/index-P-zB7q9y.js`; marker `V8.18 · 16 Oct, 01:43`.
Configuration probe: Firebase HTTP 200 (separate from real sign-ins).

- Admin `claude-qa@crystocraft.com`, fresh email/password sign-in: PASS. Correct OC dashboard and admin navigation; 96 pipeline records; Range loads 294/294 products and 713 SKUs. Navigation and heading read Crystocraft Range. Refresh retains correct shell and data; no runtime errors. Evidence: `/private/tmp/v818-evidence/range-rename-candidate-admin.png`.
- Approved customer `customer-qa@crystocraft.com`, fresh email/password sign-in: PASS. Correct QA-only customer storefront, no pending screen or admin controls. Homepage collection title/CTA, navigation and catalogue heading read Crystocraft Range; 292 visible designs, first 24 cards load. Refresh retains customer shell. Sacred Angel detail loads finish pricing, MOQ and ~9-week lead time, and Back to Crystocraft Range. No supplier costs/internal notes. `/settings` redirects to `/shop`; no runtime errors. Evidence: `/private/tmp/v818-evidence/range-rename-candidate-customer.png`.

Both QA accounts explicitly signed out. No product saves or business data changes.

## Production — PASS

Deploy: `6ad0e843f247de5c0b8801ac`, release commit `bf6bdcf3a31d0d381324cba23917d0e2f7641a28`.
Published 16 October 2026 at 01:51:41 AEDT. Verification completed at 01:54 AEDT.
Both https://portal.crystocraft.com and https://ua-product-manager.netlify.app serve `/assets/index-DHGbHpgQ.js`; Firebase configuration probes returned HTTP 200 on both. Live marker: `V8.18 · 16 Oct, 01:51`.

Fresh real-page sign-ins were performed at the Netlify production hostname to preserve the owner's working custom-domain session.

- Admin `claude-qa@crystocraft.com`, email/password: PASS. OC dashboard, 96 pipeline records, Settings/Portal navigation available. Crystocraft Range navigation and heading display correctly; 294/294 products and 713 SKUs load. Refresh retains admin shell and catalogue. No runtime errors. Evidence: `/private/tmp/v818-evidence/range-rename-production-admin.png`.
- Approved customer `customer-qa@crystocraft.com`, email/password: PASS. Correct approved QA customer storefront. Homepage collection title/CTA, catalogue navigation and heading show Crystocraft Range; 292 visible designs and 24 initial cards load. Refresh retains customer shell. Sacred Angel detail displays Back to Crystocraft Range, finish pricing (Chrome/Bohemia USD 6.44), MOQ 100 and ~9-week lead time. No admin controls, supplier costs or internal notes. `/settings` redirects to `/shop`; zero Settings links; no runtime errors. Evidence: `/private/tmp/v818-evidence/range-rename-production-customer.png`.

Both QA accounts explicitly signed out after verification. No product saves, account changes or business data changes. Firebase rules unchanged.

GitHub Actions run [38755035805](https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38755035805), job `116491094355`: all six suites passed, 115 tests, zero failures. Closure documentation uses `[skip netlify]` to preserve the verified production build.
