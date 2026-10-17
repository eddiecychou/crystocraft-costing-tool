# Product Design navigation release — 18 October 2026

Owner authorized push/deployment, desktop/mobile checks and fresh admin/customer
login verification. Source `21bca54d7469bd43d6439bdd569f28f34783ad7a`, isolated
branch `codex/product-design-navigation`, base upstream `5e6727da`. Primary dirty
checkout untouched.

## Change

Projects is the selected route link; Design tools is an accessible44px disclosure
button with expanded state/controlled-panel ID and rotating chevron. Its tools
panel is a full-width sibling below the top row, instead of being nested inside
a flex-row details item. Tools use one/two/four columns with wrapping and44px
minimum targets. Existing projects/detail/editor and all four tool routes remain.
No project records were created, edited or imported.

## Local/browser checks — PASS

- Full prebuild/build passed (Node-runner total320 plus existing standalone/Python suites). Product Design suite12 passed, including current-route indication, disclosure open/close and exact four tool links. Firebase config suite11 and changed-file no-undef lint/whitespace passed.
- Exact component in actual Projects page, fictional local data, browser widths320/375/414: all PASS. Content width equals viewport, tools panel left edge/width equals navigation row, four links stay within viewport, targets44px, open/close and keyboard focus work. Real Enter key opened the menu at414px. No physical-device certification claimed.
- Desktop visual review: only Projects marked current, expanded grid aligned across content width. Local Gallery destination/return checked against fixture route; real candidate destinations below independently tested.
- Browser-width evidence: mobile-checks.txt in task artifact folder `product-design-navigation-release-2026-10-18`; source preview images in `product-design-navigation`.

## Candidate — PASS

- Netlify site `4a234708-a213-477f-91a5-97cdc939c1db`, deploy `6ad3ac55677f16d2d12c48ce`, existing QA alias https://dsh-images-20261018--ua-product-manager.netlify.app . Served bundle `/assets/index-CxAHNvC4.js`, V8.18 · 18Oct,01:09HKT; Firebase config probe200, separate from real sign-in evidence.
- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`, Settings/Portal intact. Sidebar Product Design opened Projects; menu opened, all four exact links visible. Gallery, Prompt Templates, Generations and Workbench guide routes loaded; guide returned to Projects. Reload preserved correct admin/projects shell; menu reopened. Range297/297products,722SKUs loaded. No console errors. Signed out.
- Fresh approved customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, QA-only identity. Range295designs; Mini Butterfly Music Box detail/reload, ChromeUSD12.51 / GoldUSD12.84 and ~9weeks/MOQ100 passed. No admin/cost/internal-note controls. Direct `/design/projects` redirected to `/shop`; no console errors. Signed out.
- Branch Actions `39052666243`: completed/success before main push. Candidate screenshots saved in task artifact folder.

## Production

PASS — independent checks after publication.

- Netlify production deploy `6ad3ad3758f8e64f438262c9`, source `21bca54d7469bd43d6439bdd569f28f34783ad7a`, published18October2026 01:16:35HKT (`2026-10-17T17:16:35.130Z`).
- Served bundle `/assets/index-C0BeX7CV.js`, V8.18 · 18Oct,01:15HKT; Firebase config probe200, separately from real authentication checks.
- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`; Settings/Portal intact. Product Design opened Projects; Design tools expanded and collapsed with keyboard Enter. Live panel left edge/width matched navigation row. Gallery, Prompt Templates, Generations and Workbench guide loaded; Projects returned correctly. Reload preserved admin/projects shell and menu control. Range297/297products,722SKUs loaded; no console errors. Signed out.
- Fresh approved customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, correct QA-only identity. Range295designs; Mini Butterfly Music Box detail/reload, ChromeUSD12.51 / GoldUSD12.84 and ~9weeks/MOQ100 passed. No admin/cost/internal-note controls. `/design/projects` redirected to `/shop`; no console errors. Signed out.
- Main Actions `39052964581` and branch `39052666243`: completed/success.
- Production screenshots production-navigation.png, production-admin.png and production-customer.png; mobile-navigation.png/mobile-checks.txt in task artifact folder. Mobile width tests used the exact source on actual Projects with fictional data; production routing/auth checks used real QA accounts. No physical-device testing claimed.
- Evidence finalized18October2026HKT. Subsequent documentation-only evidence commit uses `[skip netlify]`, keeping this verified app published.

## Boundaries

No project/customer/catalogue writes, AI generation, imports, approvals,
publication, messages, roles/credentials or rule changes. Normal QA sign-in
activity may stamp login history. Firestore SHA256
`bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548`;
Storage `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`
unchanged/not deployed.
