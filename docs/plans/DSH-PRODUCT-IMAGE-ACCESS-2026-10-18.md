# DSH product image access — implementation and operator contract

Status: deployed and verified 18 October 2026. Dedicated read-only credentials
provisioned privately; fresh candidate and production admin/customer login gates
passed. Product/image approvals, WordPress pages and media remain unchanged.
Release evidence: [DSH-IMAGE-ACCESS-RELEASE-2026-10-18.md](DSH-IMAGE-ACCESS-RELEASE-2026-10-18.md).
Based on the owner's approval to implement the reusable read-only route and
`OC-IMAGE-ACCESS-REQUIREMENT-2026-10-16.md`.

## Simple workflow

1. Review an image in the existing Corporate Gifts product gallery. Only choose
   **Public** for a generic photo that may be copied to the public website.
2. Customer-branding tags always block this route, including for an image marked
   Public. Leave client mockups private/internal. Missing visibility is denied;
   this route never uses the legacy `imageVisibility()` default-to-public helper.
3. DSH fetches the approved image list for the product, downloads the selected
   files within five minutes, and copies them into the WordPress media library.
4. DSH prepares the featured image/gallery on a draft and submits it for the
   existing human review. This service neither writes WordPress nor approves or
   publishes a product. No OC write capability is granted to DSH.
5. After an image is replaced or saved as an edited copy, Public images return to
   **Storefront** visibility and must be reviewed for Public use again. Existing
   internal images remain internal. Legacy visible images remain storefront
   visible. Customer-branding tags are preserved; hero metadata mirrors the
   changed visibility. Edits and copies read the latest privacy labels in a
   transaction, refuse a replaced/deleted source, and do not overwrite another
   editor’s newer hero selection. Errors remain visible on the manual tab too.
   There is no bulk approval/backfill of existing images.

## API

`GET /api/oc/product-images?product_id=<OC products document ID>`

Header: `Authorization: Bearer <OC_PRODUCT_IMAGES_TOKEN>`. A separate machine
credential for this endpoint only; never use an owner/admin session, Admin SDK
key, existing SEO queue secret, or ordinary Firebase module access for DSH.

Response example (fictional):

```json
{
  "schema_version": 1,
  "product_id": "example_product",
  "expires_at": "2026-10-18T01:05:00.000Z",
  "images": [{
    "image_id": "example_image",
    "content_hash": "md5:<verified-file-hash>",
    "url": "https://portal.crystocraft.com/api/oc/product-image?token=<short-lived-signature>",
    "role": "primary",
    "publishable": true,
    "alt": "Generic product photo",
    "width": 2000,
    "height": 1800
  }]
}
```

Only eligible images are returned; no private image metadata is disclosed.
An empty approved gallery returns `images: []`. There is exactly one primary
when images exist: approved current hero URL, then flagged hero, then first
approved image by sort order / stable ID. Other images have role `gallery`.
Alt is existing alt/caption or empty; DSH may draft missing alt from verified
product facts. Width/height are existing optional metadata or null, not measured
pixel dimensions: DSH should inspect the downloaded file for resolution checks.

The GET download URL requires no separate header: its HMAC capability is valid
for five minutes, audience-bound and pinned to an exact object generation.
It re-reads the current image record and denies revoked/private/branded/deleted
images. A replaced file requires a fresh list. Responses are private/no-store;
no redirect exposes the original Firebase download token or Storage URL. The
server reads the object directly, validates its size, file signature and MD5,
and returns attachment bytes. No arbitrary URL is accepted from the caller.
The short-lived bearer capability should not be logged or put in a public webpage.

### Stable WordPress identity — required DSH change

Do **not** hash the signed URL: its expiry/signature changes when renewed.
Use `product_id + image_id + content_hash` as the media deduplication key and
store it as WordPress media metadata (or DSH's durable upload ledger). Reuse the
existing media ID when the key matches. A changed content hash is a new image
version requiring the normal review. `content_hash` is the actual GCS-provided
MD5 of the bytes, encoded in hex with a `md5:` prefix. It is for idempotency,
not authorization; HMAC signatures and exact Storage generations control access.
Verify downloaded bytes against that MD5 before uploading. Retries must reuse
media IDs even when the OC link has expired and been renewed. Never use the OC
signed link as the WordPress image source or fetch OC at page-render time.

### Bounds and errors

This first route supports any Corporate Gifts `products/{id}` gallery, not
just the product in the request. Range galleries and customer asset folders are
not included. It accepts only files already in the configured OC bucket under
`products/<same product ID>/images/`, with consistent `storage_path` metadata
when present. External URL/WordPress/supplier/customer-asset sources are denied;
upload a reviewed generic original into the correct OC gallery instead. These
restrictions do not alter normal catalogue image display or download routes.

Raster JPEG/PNG/WebP/GIF only; maximum 4 MiB per image and 50 gallery records per
product. SVG/HTML and unknown/oversized files fail closed. An eligible but
unavailable/unsupported source fails the request explicitly, rather than
silently presenting a partial success. No supplier, cost, internal-note, client
identity, original URL, download token or full Storage metadata is projected.

- 401: invalid/missing machine credential.
- 403: invalid signed link, revoked approval or prohibited source.
- 404: unknown product/path.
- 405: non-GET; read-only contract.
- 409: file replaced; request a fresh list.
- 410: expired link; request a fresh list.
- 413: gallery/file exceeds bounds.
- 422: explicitly approved image uses unsupported source; operator action needed.
- 503: disabled/not configured, Storage failure or byte/metadata verification failure.

## Configuration and approval before live use

The implementation defaults to **disabled**. The owner authorized push,
deployment and private credential provisioning/enablement on 18 October 2026. Do not set
Public on the target product's images or attach/publish WordPress media as part
of deploying this feature.

Server-only Netlify variables (Functions scope, set securely, never `VITE_`):

- `OC_PRODUCT_IMAGES_ENABLED=true` only in the reviewed environment.
- `OC_PRODUCT_IMAGES_TOKEN`: independently generated random secret, at least
  32 bytes, supplied privately to DSH as its sole OC image-access credential.
- `OC_PRODUCT_IMAGES_SIGNING_SECRET`: a different random secret, at least
  32 bytes; kept only on the server, never supplied to DSH.
- `OC_PRODUCT_IMAGES_BASE_URL`: exact canonical HTTPS origin; default
  `https://portal.crystocraft.com`. For preview tests set the exact preview
  origin in that environment. Client request Host headers never choose it.
- Existing server Firebase Admin credentials and the exact existing
  `VITE_FIREBASE_STORAGE_BUCKET` / `FIREBASE_STORAGE_BUCKET` are used only by
  the server. No Firebase rule changes, user/module grants or new accounts.

Do not put secrets in source, shell history, chat, screenshots, frontend config
or DSH instructions committed to Git. Provision via the existing private secret
workflow after approval. Redeploy after environment changes. To stop service,
disable the flag or rotate the signing secret (invalidates outstanding links).
Rotating only the read token blocks new lists; issued links can survive until
expiry. Nothing can retract media already copied into WordPress: removal there
requires the normal separately approved WordPress workflow.

## Verification and release checklist

Automated local checks:

- `npm run test:product-images`: endpoint/security units plus the actual rendered
  Gallery Replace original / Save as new actions with fictional storage/writes.
- Firestore + Storage emulators: `node --test qa/product-images-emulator.mjs`.
  Both loopback emulator environment variables are mandatory; live test writes
  are forbidden. Uses actual Admin SDK, GCS metadata and versioned byte streams.
- Both run in `.github/workflows/product-search.yml`; units also run prebuild.
- Production build and no-undef lint; local esbuild packaging of the Node handler.

Before enabling live:

1. Review the diff and credential scope; approve deployment/provisioning.
2. Candidate: fresh admin/customer login and ordinary catalogue checks under
   RELEASE-WORKFLOW.md. Use a local emulator for writable confidentiality cases.
3. After owner reviews a real generic image's Public setting, DSH tests list →
   download → resolution/hash check → draft-only WP attachment → safe readback.
4. Retry and link renewal must reuse media IDs; private/unknown/branded images
   must remain absent; expiry and revocation must deny old links.
5. Owner approves publication separately. No live image or product is approved
   by this implementation or its tests.

The document's report about WordPress #66627 was not independently checked here.
DSH must confirm the current draft state and OC product mapping before applying
this workflow to it.


## Completed local evidence — 18 October 2026

Branch `codex/dsh-product-image-access` in `/private/tmp/costing-summary-release`,
based on deployed-summary documentation commit `b6b1e8b9`. The original dirty
checkout is untouched. The linked release evidence distinguishes source, credentials
and candidate/production verification.

- 23 focused endpoint/gallery checks passed, including actual rendered Gallery
  replacement/copy, concurrent retagging, replaced-source rejection and retaining
  another editor's new hero selection. Manual-tab errors are visible.
- One actual Node wrapper / Admin SDK Firestore+Storage emulator integration
  passed: strict image filtering, real object metadata, versioned stream bytes,
  approval revocation and no changes to unrelated product data or source bytes.
- Full prebuild regression suites and production build passed; standard no-undef
  lint, Node handler packaging and diff whitespace checks passed.
- GitHub Actions passed: branch run `39046800701`, main code run `39047403232`.
- Firestore/Storage rule files unchanged and not deployed. App deployed as `6ad39c4b2d77a8ba493e6378`, source `78182c6c` (app code `7a9500d0`).
- Dedicated read token added to the existing private DSH `.env` (0600); the
  separate signing secret exists only on Netlify. Both secret variables are
  marked secret and scoped to Functions in production and the specific QA branch only; separate QA signing secret.
  No account, Public image approval or WordPress media change is performed.
- Fresh candidate/production admin and customer sign-ins passed. Production read-only API/download checks passed; target image metadata fingerprint unchanged. No DSH WordPress upload/publication was performed.
