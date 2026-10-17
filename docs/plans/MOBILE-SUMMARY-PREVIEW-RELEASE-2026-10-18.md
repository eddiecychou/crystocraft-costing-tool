# Mobile summary previews — 18 October 2026

Owner requested mobile checks, fixes, tests and deployment for Dashboard and
Customer Detail. App source `4ad8b3281ad61ec99c36f5545cd731ed9168ad84`, isolated
branch `codex/mobile-summary-preview`, base upstream `585ec2bb`. Original dirty
checkout untouched.

## Findings and changes

- Standalone Show more/Show less targets were40px high; raised to44px, with visible keyboard focus.
- Initial content-only320px Customer Detail stress test overflowed to1747px with a long unbroken company name/crowded card headers. Names now wrap within shrinking flex containers; card header actions can wrap to a new row. Summary URL/reference wrapping also uses overflow-wrap:anywhere.
- Real-shell mobile clicking showed collapse could strand the reader below the summary. Collapse now scrolls the shortened paragraph into view after the DOM update, without forcing a scroll on expansion.
- Summary data, periods, tasks/notes, source history, permissions and generation behavior unchanged.

## Browser-width layout gate — PASS

`node qa/summary-mobile-preview.mjs`, open http://127.0.0.1:5199/audit and Run
mobile regression checks. Actual Dashboard, CustomerDetail, CustomerWorkspace
and Layout; fictional reads, all writers blocked, no credentials/live API.

All6 combinations (both pages ×320/375/414px) passed collapsed, fully expanded
and restored states. Body and main-scroll widths equal viewport in every case;
summary text does not overflow. Twelve independent toggles (Dashboard1 and
customer combined/email/recent activity3 across three widths) expanded to all2500
characters including long URL/final detail, collapsed to identical497-character
previews and returned into the visible mobile scroll area. Targets44px high and
at least64px wide; keyboard focus, task/note controls and commitments retained.
Actual mobile navigation shell/bottom bar included,812px frame height. This is
browser viewport testing, not a physical iOS/Android-device certification.

Evidence: mobile-checks.txt and mobile-shell-check.png in the task artifact
folder `mobile-summary-release-2026-10-18`. Repeatable browser gate documented
in qa/README.md; normal component regressions remain in prebuild/GitHub Actions.

## Automated checks

Full prebuild and production build passed (Node runner total319 plus existing
standalone/Python suites). Changed-component no-undef lint, whitespace checks and
Firebase configuration suite11 passed. Added regressions preserve long Unicode
and URL text and require scroll restoration only on collapse.

## Candidate

PASS. Netlify deploy `6ad3a63ff1ffb8fe0df5c133`, existing QA alias
https://dsh-images-20261018--ua-product-manager.netlify.app . Served bundle
`/assets/index-VoRyzZiI.js`, V8.18 · 18Oct,00:45HKT; served Firebase config probe200.

- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`, Settings/Portal intact. Both actual Dashboard and internal customer record summaries expanded495→652characters and restored identical previews; Add task/Add note visible. Customer-page reload preserved correct admin shell. Range297/297products,722SKUs loaded, no console errors. Signed out.
- Fresh approved-customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, correct QA-only identity. Range295designs; Mini Butterfly Music Box detail/reload, ChromeUSD12.51 / GoldUSD12.84 and ~9weeks/MOQ100 passed. No admin/cost/internal-note controls. Internal customer-record URL redirected to `/shop`. No console errors. Signed out.
- Branch Actions `39050805333`: completed/success before main push. Candidate screenshots in task artifact folder. Browser-width matrix above used the exact source and real shell with fictional data, independently from real-page sign-in gates.

## Production

PASS — independently verified after publication.

- Netlify production deploy `6ad3a6f41060b4c67b18569c`, source `4ad8b3281ad61ec99c36f5545cd731ed9168ad84`, published18October2026 00:49:53HKT (`2026-10-17T16:49:53.362Z`).
- Served bundle `/assets/index-tYJClU-Z.js`, V8.18 · 18Oct,00:49HKT. Served Firebase config probe200; real fresh logins below were separate checks.
- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`, Settings/Portal intact. Both Dashboard and internal customer page expanded495→652characters and restored identical previews, with Add task/Add note visible. Deployed summary toggle measured44px high. Customer-page reload retained admin shell; Range297/297products,722SKUs loaded. No console errors. Signed out.
- Fresh approved customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, QA-only identity correct. Range295designs; Mini Butterfly Music Box detail/reload, ChromeUSD12.51 / GoldUSD12.84 and ~9weeks/MOQ100 passed. No admin/cost/internal-note controls. Internal customer record redirected to `/shop`; no console errors. Signed out.
- Main Actions `39051043352` and branch `39050805333`: completed/success.
- Screenshots production-customer-page.png, production-admin.png, production-customer.png in task artifact folder. mobile-comparison.png shows both actual pages at375px in the real navigation shell with fictional data; mobile-checks.txt records all six tested widths/page combinations and verified scroll restoration.
- Evidence finalized18October2026HKT. Follow-up documentation-only commit uses `[skip netlify]`; verified application stays deployed.

## Boundaries

No live summary generation/imports, task/note or customer edits, invitations,
profile/credential changes, product/image approvals/publication, WordPress
writes or messages. Normal QA sign-in activity stamps are allowed. No rules
changes/deployment: Firestore SHA256
`bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548`;
Storage `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`.
