# OC release workflow — required GitHub checks and two-role login gates

Applies to **every app release**, including Git CD, manual Netlify deployment,
MCP-only changes and emergency repairs. Read with `ARCHITECTURE-RULES.md` §7.
This workflow does not authorize pushes, deployment, account creation or changes
to credentials/permissions.

## GitHub gate — before ANY candidate or production deployment

Owner requirement, 25 October 2026: both jobs in **Product search regressions**
(`.github/workflows/product-search.yml`) MUST pass on the **exact release commit**:

- `product-search`
- `customer-merge-emulator` (includes rules, workspace and timezone checks)

An earlier commit's success, local prebuild/build, one passing job, or workflow
completion without both successful jobs does not satisfy this gate. Pending,
missing, failed, cancelled, skipped and inaccessible checks are BLOCKED. Do not
deploy first and check GitHub afterward. No implicit emergency bypass.

Use a clean committed checkout. Push the release commit with **[skip netlify]**
in its message to run GitHub CI without premature production publication. The
workflow runs on every push/PR, including scripts, build configuration and docs;
never use [skip ci] or [skip actions] for a release commit. Then run:

```bash
npm run release:ci -- --wait
```

The checker binds local HEAD to Netlify COMMIT_REF when supplied, checks the
latest matching workflow run and that run's current attempt, and requires both
named jobs to be completed/successful for that exact SHA. Dirty or uncommitted
files, another SHA, a stale attempt, missing jobs, malformed API data, authentication,
network/rate-limit failures and a 15-minute wait timeout stop the release. Record
SHA, run URL/ID, attempt and both job results before proceeding. If code, tests,
configuration or commit changes, push and pass this gate again.

`netlify.toml` runs the same guard **before** npm run build, for automatic Git
builds and normal CLI builds. A failed gate prevents the build and publication;
it never changes the existing published site. Do not remove/override that command.
The workflow's own tests run only `test:release-ci`, not the live checker (which
would wait for its own unfinished workflow).

A direct --no-build/API/upload deployment skips Netlify's build command. It is
not an alternative gate. For an already-built, tested candidate artifact, execute
the checker again immediately before the upload, in the same command chain:

```bash
npm run release:ci && netlify deploy --no-build --dir dist
# Only AFTER candidate admin/customer checks and authorized production release:
npm run release:ci && netlify deploy --prod --no-build --dir dist
```

No unrelated work or artifact changes between preflight and upload. Reuse the
exact candidate build for production. Prefer the skip-Netlify CI-first sequence
above rather than spending Netlify build minutes waiting for GitHub. A later Git
push can replace a manual production deploy; keep documentation/test-only pushes
marked [skip netlify], and check the actually published deploy after each release.
This workflow does not grant publishing permission.

## Prepare the exact candidate

After BOTH GitHub jobs pass, preserve dirty checkouts. Record commit, GitHub run
ID/attempt and both job results, Netlify site and candidate deploy ID/URL.
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

Obtain explicit release approval. Recheck BOTH GitHub jobs for the unchanged
release commit immediately before publication. Deploy approved rules separately, rules-first
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
IDs, GitHub run URL/ID/attempt and the two job conclusions for that exact SHA,
served bundle/build marker, test counts, Firebase probe status, separate rules
state and verification time/timezone. For **each role separately**, record:

- Authorized QA identity (no credentials), sign-in method and fresh-login result.
- Expected role/approval, destination URL, data/access/refresh/runtime results.
- Screenshot without unnecessary customer/financial data; any issues/exceptions.

Results are `PASS`, `FAIL` or `BLOCKED`. Completion requires **both GitHub jobs PASS for the released SHA and all required
checks PASS for both roles on the current production build**. Never say "login verified"
from a build, key probe, MCP manifest, mock or restored admin session alone.
If access is unavailable, report the blocker and request operator verification.

Established by L-61 and the owner's 15 October 2026 two-role release requirement.
