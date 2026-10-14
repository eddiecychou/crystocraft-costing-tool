# Seven-component writer permission review

Scope: isolated local prototype, dedicated `mcp-figurine-range-service` identity
with staff role, `modules:[]`, B0016 custom claim and profile scope. No new
Admin SDK permissions or production credentials were provisioned. Target
database is the existing `(default)` native-mode database; local emulator is
Standard edition. No database migration or provisioning was performed.

I've set up prototype Security Rules to keep the data in Firestore safe. They
are designed to be secure for the dedicated B0016 identity by restricting reads,
requiring a private exact owner-approved plan for writes, preserving C1 and
enforcing the atomic audit/quote/component/BOM bundle. However, you should
review and verify them before broadly sharing your app. If you'd like, I can
help you harden these rules.

## Access and trust boundary

- Filtered B0016 design reads only, six exact SKU claims, exact source concept
  and its two components/quotes, two supplier IDs, colour settings, exact C1
  and C1 quote-list for duplicate checks. No all-component/supplier listing.
- Own deterministic component/quote/audit IDs may be fetched, including absent
  IDs to check retry/conflicts. Five colour-suffixed component IDs added.
- A private `range_mcp_approvals/{auditId}` may be fetched, never listed,
  created or modified by the MCP. Only existing admin users may approve/revoke.
- Approval is an explicit trust boundary: an owner/admin reviews the exact
  server-generated fields and fresh collision/quote audit, then provisions a
  short-lived plan. No tool for self-approval or arbitrary document write exists.
  The plan expires within one hour, binds typed C1 before/after snapshots,
  component/quote IDs and fields, the BOM refs, and the audit fields.
- Component costs and source notes stay in private supply-side records and the
  private approval, never customer-readable range documents.
- All new service writes remain denied by checked-in `b0016WritesApproved()==false`.
  Endpoint hard-codes writes off, independent of environment variables;
  code-audit certification is also unwired/false.

## Attack results

The first inline seven-record validator exceeded the emulator's 1,000-expression
budget and was replaced, not shipped. The exact-plan version permits a valid
16-record bundle within the emulator limits. Tests reject missing audit/quote/
component/C1 update; orphan or wrong-colour refs; wrong CF002 code/source/cost/
currency; price/status/cost-field injection; C1 name/stock/note overwrite;
wrong principal/hash; duplicate refs; pre-assigned C1 costs; stale/expired/missing
approvals; service self-approval/listing; and repeat writes. Checked-in phase-one
rules reject the entire valid bundle as well.

The approval binds a snapshot, not a global Firestore uniqueness index for all
legacy component codes. An authorized supply operator could add a conflicting
legacy code or C1 child quote after the privileged audit without changing C1.
Repeat the owner audit immediately before plan approval; this release does not
claim race-proof global uniqueness against unrelated manual/admin writes.
No production approval exists and no live write should be enabled until this
operational boundary is reviewed.

```json
{
  "score": 4,
  "summary": "Local scoped prototype passed 145 emulator checks; production service writes remain disabled.",
  "findings": [
    {
      "check": "Business Logic vs. Rules",
      "severity": "minor",
      "issue": "Legacy code uniqueness and unknown C1 child-quote absence require a fresh privileged owner audit; the scoped identity cannot scan unrelated supplier costs.",
      "recommendation": "Review the fresh audit and exact expiring approval before any separately authorized write release; do not describe legacy uniqueness as race-proof."
    }
  ]
}
```

## Exact release order — not executed

1. Review isolated code/rules diff and all smoke-test evidence. Approve merge/push
   separately; do not modify the dirty original checkout to integrate it.
2. With separate deployment approval, deploy the read-only rules first (false
   write gate), provision the dedicated scoped Auth identity, deploy endpoint
   with writes off and register/restart the separate local MCP. Verify actual
   tools/list, harmless reads/dry-runs and direct Firestore denial.
3. Review the six supplied SKUs, taxonomy/plating warnings and supplier colour
   coverage. Only with separate approval create the inactive Concept design.
   Re-run colour-BOM preparation with its actual ID, generating a new hash.
4. Run fresh privileged legacy-code/C1 quote audit. Owner reviews/provisions
   the exact private approval using real Firestore timestamp types and at most
   one-hour expiry; service cannot approve itself. Do not do this during tests.
5. Only after separate owner approval, review/test/deploy the write-gate rules
   release, deliberately wire audit certification, and change the endpoint's
   hard-coded false gate in a separately approved code release.
   Then submit the exact approved UUID/hash request. Do not publish prices.
6. Re-read all 16 records and source concept; confirm C1 preserved, exact colour
   links, seven quotes, one audit and no price/status changes. Disable the
   endpoint/gate again and revoke the private approval if rollout is one-off.
