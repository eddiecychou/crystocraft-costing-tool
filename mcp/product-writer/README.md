# Operation Center corporate-gift writer (local MCP)

This local stdio server exposes `create_corp_gift_product_draft` and
`create_corp_gift_product_with_supplier_quote`.
It calls the authenticated Operation Center endpoint; it has no Admin SDK or
service-account credential. The endpoint writes one `products/{id}` record with
`status: concept` and `active: false`. Staff finish images, sourcing, costing,
and any activation in the Operation Center UI.

The second tool requires an existing supplier ID and both the `products` and
`supply` capabilities. It creates the inactive concept product, a single
component, and its preferred supplier quote in one atomic write. It does not
create suppliers, upload images, set sales prices, calculate freight or margin,
or activate the product. Quote terms and supplier cost belong in quote fields,
never in catalogue descriptions. To add a quote to an existing product, use
the Operation Center UI; the bundled tool only creates a new product.

## Install and sign in (macOS)

Run from `mcp/product-writer`:

```sh
npm ci
export OC_FIREBASE_API_KEY="<the project's public VITE_FIREBASE_API_KEY>"
npm run login
```

The API key is the public Firebase web-app key already used by the Operation
Center (`.env.local` on a configured checkout); it is not a service credential.
The sign-in prompt hides the password. The password is used once and discarded;
the renewable Firebase user refresh token is saved only in macOS Keychain
under service `com.crystocraft.operation-center.product-writer` and account
`crystocraft-costing`. The MCP process reads it, refreshes short-lived user ID
tokens, and sends those tokens to the endpoint. Access is checked against
`products` (and `supply` for the bundled tool) on every call. Re-run login if the
session is revoked or expires. For an alternate Firebase project, set
`OC_FIREBASE_PROJECT_ID` consistently for login and MCP runtime; the server's
endpoint must use that same project.

The Keychain helper invokes Swift and may show a macOS Keychain permission
prompt. No token or password is passed as a command-line argument, stored in
the repository, or used as an MCP tool argument. Never paste credentials into
an MCP conversation.

## Register in Codex

The Codex app and CLI share `~/.codex/config.toml`. Add this stanza to your
personal config; do not commit it or replace other MCP entries:

```toml
[mcp_servers.oc_product_writer]
command = "node"
args = ["/Users/eddie/Developer/costing-tool/mcp/product-writer/server.mjs"]
env_vars = ["OC_FIREBASE_API_KEY", "OC_BASE_URL", "OC_FIREBASE_PROJECT_ID"]
```

Export `OC_FIREBASE_API_KEY` in the environment that launches Codex. The
optional `OC_BASE_URL` defaults to `https://portal.crystocraft.com`; override
only for a trusted test deployment. Ask Codex to create a corporate-gift draft
and review the proposed fields before approving the write. Generate one UUID
for `request_id` per intended product, then reuse that UUID and **identical
content** if a call times out. A reused UUID with changed content is rejected.
The bundled response also contains component and quote IDs. The response says
whether records were newly created or returned from an earlier call. Do not
reuse a draft-only request ID for the bundled tool: it creates a different
record set and will conflict with the already-created draft.

## Supplier-cost currencies

Supplier quotes use the Operation Center's accounting codes: `RMB`, `HKD`,
`USD`, or `EUR`. The writer accepts `CNY` as a convenience alias for Chinese
yuan, but normalises it to `RMB` before saving; it never stores `CNY` on a
quote. Other currencies are rejected rather than being treated as a 1:1 HKD
cost.

## Scope and privacy limit

The draft-only tool cannot set `active`, `status`, images, prices, MOQ,
suppliers, or arbitrary Firestore paths. The bundled tool accepts only an
existing supplier ID and bounded quote fields; it cannot set catalogue price
or arbitrary Firestore paths. `active:false` excludes the draft from the customer
corporate-shop listing. **It is not a Firestore confidentiality boundary:**
current `products/{id}` read rules permit approved customers to read product
documents directly if they know the ID. Do not put confidential supplier or
customer information in product text fields. A separate rules/UI design
change would be needed before calling these records customer-inaccessible.
The endpoint also stores `mcp_creator_uid` and `mcp_request_hash` on its own
drafts solely to verify idempotent retries. The app does not display them.

## Verify

```sh
npm test
```

Tests use a mocked Firestore REST response and do not write production data.
There is no live product creation in setup or test.
