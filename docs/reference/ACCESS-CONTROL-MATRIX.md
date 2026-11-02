# Access-control contracts — Daily Drafts pilot

Verified 3 November 2026 (Sydney). This describes existing behaviour, not a new
permission policy. It is a bounded pilot for the later shared-helper cleanup;
it does not establish parity for every OC endpoint or role lifecycle.

## Human role/module decisions

Each row is exercised against the real client `resolveModules` + `canAccess`,
shared `requireModule`, both AI handlers, and actual Firestore/Storage rules.
The two handlers require **marketing**; the customers column applies to the
client/shared helper and CRM resources, not to those AI handlers.

| Synthetic profile | marketing | customers |
|---|---|---|
| admin, no modules or unrelated modules | Allow | Allow |
| staff, marketing only | Allow | Deny |
| staff, customers only | Deny | Allow |
| staff, both | Allow | Allow |
| staff, empty / missing / string / null modules | Deny | Deny |
| approved customer with forged marketing/customers modules | Deny | Deny |
| legacy sales, unknown or missing role, even with those modules | Deny | Deny |
| missing user document | Deny | Deny |
| unauthenticated | Deny | Deny |

The UI checks must use the **resolved** profile modules. Passing arbitrary
modules directly to `canAccess` does not authenticate their owner. UI gates are
a convenience; server checks and Firebase rules protect resources.

## Resource ownership

| Surface / resource | Required capability | Evidence in this pilot |
|---|---|---|
| `/marketing` UI | marketing | Route inspected in src/App.jsx; actual client permission functions tested |
| `/api/draft-outreach-topic` | marketing | Actual handler, signed-session checks, success/error responses |
| `/api/discuss-outreach-draft` | marketing | Actual handler, signed-session checks, success/error responses |
| Firestore outreach_drafts, draft_memory_rules, outreach_topic_templates | marketing | Emulator document reads and creates |
| Storage daily_draft_images | marketing | Emulator object metadata reads and new uploads |
| Firestore marketing_contacts | **customers** | Emulator document reads and creates |
| Storage marketing_contacts/{contactId}/… | **customers** | Emulator object metadata reads and new uploads |

Marketing staff access does not imply CRM access. Do not change a module key
because a collection or page name contains “marketing”. The existing broader
RBAC suite remains required for paths and operations outside this pilot.

## Session and response contracts

The shared helper and both endpoints verify a Bearer token using JOSE 5.9.6,
the Google securetoken JWKS, issuer
`https://securetoken.google.com/<project>` and audience `<project>`. Profiles
are read from Firestore users/{verified subject} with that same Bearer token.
Claims declaring a role/module do not substitute for the stored profile.

| Condition | Existing result |
|---|---|
| Missing / non-Bearer credential | 401, `Not signed in` |
| Invalid signature, expired, future nbf, wrong issuer/audience, unknown key or malformed token | 401, `Invalid or expired session`; no profile/AI call |
| Valid session, insufficient role/module or non-OK profile HTTP response | 403, `Access denied`; no AI call |
| Missing project configuration | 500, `Server not configured` |
| Endpoint missing AI key | 500, `Server not configured`; shared helper does not need that key |
| Endpoint non-POST method | 405, `Method not allowed`, before config/auth/body checks |
| Authorized malformed JSON / missing required input | Existing 400 error; no AI call |
| Authorized topic generation | 200, `{ subject, body }` |
| Authorized refinement | 200, `{ reply, subject, body }` |
| Thrown profile transport error / invalid profile response JSON | Currently propagates a rejection, rather than returning a normalized 403 |

Project selection is `VITE_FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID`.
Bearer matching is case-insensitive. Shared `requireModule` arrays mean any
matching module; admin succeeds even for an empty requested array. Explicit
`requireRole` and `requireAdmin` return shapes are also pinned by tests.

## Limits and migration conditions

- This is an ordinary human-account matrix. Both rule sets exclude the reserved
  mcp-range-upload-service identity at their signed-in helper. The shared helper
  does not contain that UID exclusion; both endpoints' profile REST read is
  itself subject to Firestore rules. Service identities and their
  scoped exceptions must be reviewed separately before claiming general parity.
- These gates do not check profile.status. Signup approval, suspension and
  customer routing are separate concerns; this is not an account-lifecycle audit.
- The offline suite runs actual production source with the matching real JOSE
  verifier and ephemeral RSA keys. JWKS **transport/trust data**, Firestore,
  Deno env and AI transport are replaced with strict fictional fixtures. This
  proves verification/authorization behaviour, not live Google key retrieval,
  rotation, Firebase Auth issuance or production configuration.
- Emulator auth contexts do not validate real JWTs; the offline suite supplies
  that complementary verification. Rules tests cover the operations listed
  above, not collection queries, all descendants, update/delete or every module.
- No new browser sign-in, live AI call, email, permission edit or deployment is
  needed for this QA-only batch. Existing application verification remains dated
  in its own release record.

For subsequent authorized migrations, replace only one endpoint's local gate with
requireModule and its caller-verified capability, retaining method/config ordering and its exact
failure/success contracts, rerun both suites and all required checks, then use
the normal candidate/production release gates. Transport-error normalization,
policy changes and Node Admin SDK consolidation are separate work.

## Run and maintain

`npm run test:access-contracts` runs 38 offline cases, including 14 explicit
profile rows. `qa/access-contracts-emulator.mjs` runs 15 role/session cases and
180 read/create authorization decisions against real rule source:

```sh
npx --yes firebase-tools@15.33.0 emulators:exec --only firestore,storage \
  --project crystocraft-rbac-test "node --test qa/access-contracts-emulator.mjs"
```

Use Node 22, Java 21 and installed npm dependencies. The emulator suite refuses
to run without both loopback emulator hosts and a fixed test project; synthetic
profiles and files remain in emulators. Run emulators in an isolated instance;
do not attach to another task's emulator data. The shared case file has explicit
expected outcomes, never expectations calculated from a permission helper.
Both required GitHub jobs run the new checks; prebuild also runs the offline
suite. Workflow permissions, existing cases and timeouts are unchanged.

## First migration

The owner authorized the topic endpoint's migration after this pilot. It now
uses the existing shared marketing helper; refinement remained inline at that release. All 34
contracts (three added for topic/provider behaviour) pass before and after the
change. No role/module policy changes are included. Deployment state and new
evidence are recorded separately in the [topic-auth record](../plans/V8.20-TOPIC-AUTH-CLEANUP.md).

The owner subsequently authorized refinement. It now uses the same helper;
four new refinement cases bring the offline total to 38, passing before and
after the change. The [refinement record](../plans/V8.20-REFINEMENT-AUTH-CLEANUP.md)
tracks its separate deployment gates. The pair's shared-helper use does not
prove general service/account-lifecycle parity or authorize other migrations.
