# Login configuration incident — 15 October 2026

## Root cause

The B0016 manual app release bundled Netlify's masked Firebase API key (20
characters containing asterisks). Firebase returned HTTP 400: "API key not
valid. Please pass a valid API key." `Login.jsx` caught every sign-in failure
and displayed "Invalid email or password", wrongly suggesting an account issue.
Unit/MCP/rules tests and a successful build did not exercise browser Firebase
authentication. This was a release-verification failure, not the old L-01
profile self-heal demotion.

## Account checks (read-only)

`eddie@uart.com.hk` still has its original Auth identity, password provider,
enabled account and `users/{uid}` role `admin`, status `approved`. Profile
update time 2026-10-14T09:28:31.937Z predates the B0016 release. No credential,
profile, rule or catalogue changes are part of this repair.

## Repair and permanent checks

- Rebuild from the existing verified local public Firebase config, not CLI masks.
- `vite.config.js` validates all six client config fields for every build;
  masked/missing/placeholder keys, malformed keys and wrong project block builds.
- Login distinguishes site configuration/network/throttling/email-format errors
  from non-enumerating credential failures; trims the email, never the password.
- `qa/firebase-login-config.test.mjs`: 11 tests pass. Login no-undef check passes.
- Correct local config passes a read-only Firebase createAuthUri probe (HTTP 200).
- Production verification must use the actual served bundle key and return 200;
  the owner completes the password sign-in. A key probe is not a login test.

Owner explicitly approved deployment and main push in chat. Work is isolated in
`/private/tmp/costing-b0016-colour-bom`; the dirty original checkout is untouched.
No Firestore rules deployment is required.

## Live result

- Repair commit `d1529ffc6b71d1b20cdbd037ba0ab3e64bb45791` pushed to main.
- Netlify production deploy `6acf9efeb53b9a665648a027` published successfully.
- Actual served `/assets/index-ByR7q_UL.js` passes configuration validation;
  read-only Firebase probe returns HTTP 200, replacing the previous HTTP 400.
- Refreshing the user's Chrome OC tab restored `/dashboard`, showing
  `eddie@uart.com.hk` and the admin-only Settings/Portal/system navigation.
  This verifies authenticated admin session restoration and data loading.
  No password was read, entered, reset or changed; fresh password-entry sign-in
  was not separately tested.
- A build with missing client configuration was deliberately tested and blocked
  before bundling. Original dirty checkout remains untouched.
