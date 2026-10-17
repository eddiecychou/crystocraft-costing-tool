# Shared Product Design navigation release — 18 October 2026

Owner requested shared Projects/Design Tools navigation on Gallery, JSON
templates, Generations and Workbench guide, desktop/mobile testing and deployment.
Source `5de74d7dd56884709f5b1fff18d327246cbf0999`, isolated branch
`codex/shared-product-design-navigation`, base upstream `c5b444b2`. Original dirty
checkout unchanged.

## Implementation

`src/components/ProductDesignNav.jsx` replaces the Projects-local menu and is
used by project list/detail/editor plus all four requested tool landing pages.
Projects is always reachable; it closes the menu on return. Tool pages start
with the grid open and highlight their actual route; Projects is current only
on project routes. All prior destinations retained. Duplicate Gallery back link
and guide quick-link row replaced by the shared navigation. No workflow/data,
permissions, gallery records, templates or generations changed.

## Automated/local checks — PASS

- Design suite18 passed, including mounts of all five actual pages with fictional reads/blocked writes. Each direct-entry page retains all tools, route indication, disclosure state and a working Projects return. Tool-to-tool SPA navigation updates selection.
- New regression suite `qa/pd-navigation.test.mjs` included in existing `test:design-projects`, hence prebuild/GitHub Actions. Full prebuild/build passed (Node totals326 plus existing standalone/Python suites). Firebase configuration11 passed. Changed JSX no-undef lint and whitespace checks passed; TSX resolved/transpiled by build and actual-page tests.
- Browser matrix20/20 PASS: five actual pages ×320/375/414/1280px using `qa/pd-navigation-preview.mjs` and `/audit`. Body never wider than viewport; full-width panel matches primary row; all44px targets fit, four links retained, correct current tool, open/close and Projects return worked. Browser viewport tests, not physical-device certification. No production connections/credentials in fixture.
- `qa/README.md` records the repeatable browser audit. Evidence `layout-checks.txt` and mobile-gallery.png in task artifact folder `shared-product-design-navigation-2026-10-18`.

## Candidate

PASS. Netlify candidate `6ad3afde179b7314a00cd8da` on existing QA alias
https://dsh-images-20261018--ua-product-manager.netlify.app . Served bundle
`/assets/index-Cy9Wd-Su.js`, V8.18 ·18Oct,01:25HKT; Firebase config probe200,
separate from actual authentication checks.

- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`, Settings/Portal intact. Each of Gallery, Prompt Templates, Generations and Workbench guide loaded with shared navigation open, its own link current, and a working Projects return that closed the menu. Projects reload preserved admin shell and navigation. Range297/297products,722SKUs loaded; no console errors. Signed out.
- Fresh approved-customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, QA-only identity correct. Range295designs; Mini Butterfly Music Box detail/reload, ChromeUSD12.51/GoldUSD12.84 and ~9weeks/MOQ100 passed. No admin/cost/internal-note controls. Direct `/design/templates` redirected to `/shop`, no console errors. Signed out.
- Branch Actions `39053776534` completed/success before main push. Candidate screenshots saved in task artifact folder.

## Production

PASS — independent checks after publication.

- Netlify production deploy `6ad3b0a8b56825e4ed7e7c2f`, source `5de74d7dd56884709f5b1fff18d327246cbf0999`, published18October2026 01:31:24HKT (`2026-10-17T17:31:24.965Z`).
- Served bundle `/assets/index-CtD0QLtM.js`, V8.18 ·18Oct,01:30HKT; served Firebase config probe200, separately from fresh sign-ins.
- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`, correct Settings/Portal/admin shell. Each of Gallery, Prompt Templates, Generations and Workbench guide had shared navigation open, current-tool indication and working Projects return. Projects return closed the menu. Gallery→JSON templates tool-to-tool navigation worked; direct template-page reload retained shared navigation open and templates current. Range297/297products,722SKUs loaded. No console errors. Signed out.
- Fresh approved customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, QA-only identity correct. Range295designs; Mini Butterfly Music Box detail/reload, ChromeUSD12.51 / GoldUSD12.84 and ~9weeks/MOQ100 passed. No admin/cost/internal-note controls. `/design/templates` redirected to `/shop`; no console errors. Signed out.
- Main Actions `39054039564` and branch `39053776534`: completed/success.
- Production-guide.png, production-admin.png, production-customer.png in task artifact folder. Desktop/mobile matrix above used exact source and actual pages with fictional reads; live route/login checks independently used real QA accounts. No physical-device test claimed.
- Evidence finalized18October2026HKT. Documentation-only follow-up uses `[skip netlify]`, retaining the verified published app.

## Boundaries

No project/customer/catalogue writes/imports, generations, uploads, approvals,
publication, messages or credential/role changes. Normal QA sign-in stamps may
update. No rules deployment: Firestore SHA256
`bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548`;
Storage `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`
unchanged.
