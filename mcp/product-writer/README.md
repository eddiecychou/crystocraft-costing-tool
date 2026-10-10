# Operation Center corporate-gift writer (local MCP)

This local stdio server exposes restricted corporate-gift draft tools plus the
read-only catalogue tools `search_products`, `get_product`,
`get_product_costing_readiness`, and `prepare_catalogue_collection`.
The latter is **dry-run only** in this first release: it validates planned
catalogue metadata and pricing against real OC data but cannot save, activate,
or publish a price. The endpoint writes one `products/{id}` record with
`status: concept` and `active: false`. Staff finish images, sourcing, costing,
and any activation in the Operation Center UI.

The second tool requires an existing supplier ID and both the `products` and
`supply` capabilities. It creates the inactive concept product, a single
component, and its preferred supplier quote in one atomic write. It does not
create suppliers, upload images, set sales prices, calculate freight or margin,
or activate the product. Quote terms and supplier cost belong in quote fields,
never in catalogue descriptions. To add a quote to an existing product, use
the Operation Center UI; the bundled tool only creates a new product.

## Service identities (macOS)

Run from `mcp/product-writer`:

```sh
npm ci
export OC_FIREBASE_API_KEY="<the project's public VITE_FIREBASE_API_KEY>"
npm run provision-service
```

`provision-service` is an owner-approved production action: it creates or
updates two Firebase Auth service principals. The existing writer principal has
only `products` + `supply`; the separate pricing dry-run principal has
`products` + `supply` + `pricing`. Neither is an admin account. The process
uses the configured local service-account file only to mint short-lived Firebase
tokens; no browser sign-in is required. The legacy Keychain login remains an
explicit diagnostic fallback (`OC_PRODUCT_WRITER_AUTH=interactive`).

Every later live MCP write will record both `service_principal` and optional
`requested_by` session metadata in the append-only audit log. This first
release performs no new writes, so no audit record is created during a read or
dry run.

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
`USD`, or `EUR`. The MCP exposes only these canonical units; use `RMB` for
Chinese yuan. The write endpoint defensively normalises legacy direct `CNY`
requests to `RMB`, so it never stores `CNY` on a quote. Other currencies are
rejected rather than being treated as a 1:1 HKD cost.

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
