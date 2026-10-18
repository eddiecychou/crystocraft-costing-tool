# Checkout synchronization and published-build verification — 18 October 2026

## Release identity and separate states

Owner requested checkout reconciliation, then push/deploy. Reconciled application
source is `78964e95a82af4525ef5e7af1f79997ac0211a2c`. `git push origin main`
returned **Everything up-to-date**. Netlify independently reported that exact
source already published at https://portal.crystocraft.com:

- Site: `ua-product-manager`, `4a234708-a213-477f-91a5-97cdc939c1db`.
- Current ready deploy: `6ad44eb7f02590fa05e11024`.
- Published: 18 October 2026 15:45:36 AEDT / 12:45:36 HKT.
- Served bundle: `/assets/index-CbHxYnXQ.js`; sidebar V8.18 · 18 Oct, 12:45 HKT.
- Netlify's current-deploy identity was re-read after the browser checks and
  remained unchanged. No replacement deployment was triggered.
- This evidence-only follow-up uses `[skip netlify]` and does not change app bytes.

Original commit and all 55 original tracked/untracked working files remain in
branch `codex/preserve-checkout-20261018`, tagged stash snapshot
`codex/preserved-wip-20261018`, and a separately verified archive. All saved file
hashes were checked. Older pending edits were shelved rather than replayed over
newer upstream fixes. Main was clean and 0 ahead / 0 behind before this note.

## Local validation

Dependencies synchronized from the lockfile. Full prebuild and production build
PASS: 357 Node tests with zero failures, 71 WhatsApp assertions, 228 standalone
SEO checks and 5 Python checks. Firebase login configuration tests: 11 PASS.
Existing large-chunk warning only; diff check passed. No source edits in this
verification. Build evidence: `/private/tmp/costing-reconcile-build.log`.

## Production real-page checks — PASS

Performed 18 October 2026, approximately 18:45–18:52 AEDT. Dedicated initially
signed-out in-app browser tabs were used; the owner's Chrome session was not
changed. Both QA accounts were explicitly signed out afterward and production
QA tabs closed.

- Admin `claude-qa@crystocraft.com`: fresh email/password sign-in to `/dashboard`
  PASS; correct identity, Settings/Portal/admin shell, dashboard data (3 due,
  20 Pipeline, 11 production, 13 new orders). Range loaded 297/297 products and
  722 SKUs. Full-page reload retained admin shell and catalogue. Error logs empty.
- Approved customer `customer-qa@crystocraft.com`: fresh email/password sign-in
  to `/shop` PASS, QA ONLY company label, customer-only navigation. Range loaded
  295 designs; Mini Butterfly Music Box detail loaded Chrome USD12.51 / Gold
  USD12.84, ~9 weeks and MOQ100. Catalogue reload retained the customer shell.
  No admin/supplier-cost/internal-note controls observed. Direct `/settings`
  navigation redirected to `/shop`; error logs empty.

## Exact deployed-build URL — PARTIAL, not a new candidate release

The existing published deploy permalink was checked separately:
https://6ad44eb7f02590fa05e11024--ua-product-manager.netlify.app . This was an
existing production build, not a newly created prepublication candidate.

Admin fresh sign-in, dashboard/admin navigation, Range 297/297 products and
722 SKUs, refresh persistence and empty error log PASS; admin signed out.
Customer fresh sign-in PASS to the expected QA-only `/shop`. Subsequent
catalogue navigation stalled and a reload timed out; browser transport then
closed. Customer catalogue/detail/isolation/refresh checks on this hostname
remain **BLOCKED**, not PASS. Exact-build customer cleanup could not be
confirmed after transport closed; its temporary tab was not marked to persist.

## Supplemental configuration probe — BLOCKED by connection timeouts

`verify-deployed-login.mjs` could not complete from the shell on production or
the permalink. Both Node and system curl requests to assets timed out; the
production login HTML did return HTTP200 and exposed the bundle above. No
HTTP200 Firebase configuration probe result is claimed. The real browser
password sign-ins above independently succeeded. Do not describe this as a
fully closed candidate-plus-production release gate.

## Data and rules boundary

No Firebase rules deployed, accounts/permissions/credentials changed, business
records edited, summary generation, messages, imports, uploads or publishing
performed. Normal QA sign-in activity stamps may update.

Firestore SHA256: `bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548`.
Storage SHA256: `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`.

Screenshots: `/Users/eddie/.codex/visualizations/2026/10/18/01a14dec-0457-72f1-89ae-8f38e4c5c66e/release-verification/`:
`production-admin.png`, `production-customer.png`, `exact-build-admin.png`.
The product screenshot was captured while availability was still checking;
~9 weeks/MOQ100 were subsequently observed in the accessibility state.
