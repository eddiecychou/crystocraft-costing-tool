# OC release workflow — mandatory two-role login gate

Applies to **every app release**, including Git CD, manual Netlify deployment,
MCP-only changes and emergency repairs. Read with `ARCHITECTURE-RULES.md` §7.
This workflow does not authorize pushes, deployment, account creation or changes
to credentials/permissions.

## Prepare the exact candidate

Preserve dirty checkouts. Record commit, Netlify site and candidate deploy ID/URL.
Build from verified public Firebase configuration, never masked CLI/connector
values or invented placeholders. Do not disable the existing Vite guard.

Run the production build, applicable lint/domain tests, and:

```bash
node --test qa/firebase-login-config.test.mjs
node scripts/verify-deployed-login.mjs <candidate-https-url>
```

Rules changes also require the RBAC emulator suite. Prefer a candidate deployment
before production. The served-bundle Firebase probe must return HTTP 200, but it
is **not** an authenticated login test.

## Test admin AND customer before publication

Use separate clean browser sessions without existing Firebase/localStorage auth.
Do not sign the owner out of their working browser. Use an authorized admin and
an owner-designated **approved customer QA account**, never an unrelated client.
Do not create accounts, broaden access or change profiles to make tests pass.
Let the owner enter credentials where necessary; never read redacted passwords,
print tokens or substitute a minted service/Admin token for real-page sign-in.

| Required check | Admin | Approved customer |
|---|---|---|
| Fresh real-page sign-in | Expected admin identity authenticates | Expected customer identity authenticates |
| Routing/profile | OC dashboard; admin/approved intact, not PendingScreen/storefront | Customer portal/storefront; customer/approved intact, not OC/PendingScreen |
| Data loading | Dashboard and catalogue load | Catalogue and one product detail load |
| Access separation | Settings/Portal/admin navigation available | No admin controls, supplier costs or internal notes; admin-only route refused/redirected |
| Refresh | Remains in correct admin shell | Remains in correct customer shell |
| Runtime | No auth/profile permission failure or missing lazy chunk | No auth/profile permission failure or missing lazy chunk |

Use the account's real sign-in method, and separately test any method changed by
the release (e.g. Google). Use view-only QA fixtures; no product saves, price
publishing, invitations or password-reset emails. Normal sign-in activity may be
stamped, so do not claim real login tests are strictly write-free. Test invalid
credentials locally/emulated, not by repeatedly failing real-account sign-ins.

Missing credentials, an unavailable QA customer, an unauthorized preview domain
or any failed check is **BLOCKED**, not SKIP/PASS. Ask for minimum operator help;
do not change Auth domains or credentials automatically. Do not publish a routine
release until both roles pass. Emergency publication before the gate requires
explicit owner approval of the named gap; keep it labelled unverified and finish
the missing checks immediately afterward. No implicit emergency bypass.

## Publish and repeat on production

Obtain explicit release approval. Deploy approved rules separately, rules-first
when required. Record production deploy ID/commit and the actually served build.

```bash
node scripts/verify-deployed-login.mjs https://portal.crystocraft.com
```

Then repeat **both fresh sign-ins and every table check on production**. A
candidate pass does not prove production configuration; a restored old session
does not prove fresh sign-in. Re-run after any subsequent deployment replaces
the verified build, including Git CD after a manual deploy.

If either role fails, stop further publishing/live catalogue writes and diagnose
and fix forward. Keep verification FAIL/BLOCKED. Never reset a password, recreate
a user, rewrite role/status, weaken rules or roll back automatically based on a
generic sign-in error.

## Evidence required to close a release

Save a concise record in `docs/plans/` with commit, candidate/production deploy
IDs, served bundle/build marker, test counts, Firebase probe status, separate rules
state and verification time/timezone. For **each role separately**, record:

- Authorized QA identity (no credentials), sign-in method and fresh-login result.
- Expected role/approval, destination URL, data/access/refresh/runtime results.
- Screenshot without unnecessary customer/financial data; any issues/exceptions.

Results are `PASS`, `FAIL` or `BLOCKED`. Completion requires **all required checks
PASS for both roles on the current production build**. Never say "login verified"
from a build, key probe, MCP manifest, mock or restored admin session alone.
If access is unavailable, report the blocker and request operator verification.

Established by L-61 and the owner's 15 October 2026 two-role release requirement.
