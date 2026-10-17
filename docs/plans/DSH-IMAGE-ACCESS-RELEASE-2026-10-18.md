# DSH image access release — 18 October 2026

Owner explicitly authorized push/deployment, private read-only credentials, fresh
admin/customer login checks and a DSH draft message. No image/product approval,
upload to WordPress, activation or publishing was authorized or performed.

## Source and hosting

- App source: `7a9500d08c7fce944cf29bcbdd04e2754cb72cce`.
- Documentation-only correction: `78182c6c368592749f8243803086a2ffb3b77fc3` removes a dummy checksum that collided with a pre-existing secret scanner value. Scanning was not disabled/weakened; no credential values are recorded here.
- Base: current upstream `b6b1e8b9`; original dirty checkout and separate unpublished importer commits excluded.
- Candidate: `6ad39a31f8c51b5c1cccace5`, https://dsh-images-20261018--ua-product-manager.netlify.app . Source app bytes exactly match `7a9500d0`.
- Candidate bundle `/assets/index-kqxNYJoM.js`, V8.18 · 17 Oct, 23:49 HKT.
- Site `4a234708-a213-477f-91a5-97cdc939c1db` (`ua-product-manager`).
- Initial production Git build `6ad39b39a910da0f6c35cadf` failed its scanner and never published; build/prebuild tests and bundling had passed. No rollback occurred. The dummy example was replaced; no scan exceptions were added.
- Corrected production Git deploy: `6ad39c4b2d77a8ba493e6378` published 18 Oct 00:04:31 HKT; all production gates below PASS.

## Private credential setup

- DSH's existing `/Users/eddie/Developer/Deepseek Workbench/.env` gained only `OC_PRODUCT_IMAGES_BASE_URL` and `OC_PRODUCT_IMAGES_TOKEN`, mode 0600. Existing keys were preserved. Never put the token in Git/messages or screenshots.
- Independent 48-byte random read token and server signing secret generated privately. The signing secret was not printed or saved locally and is absent from DSH's config.
- Netlify `OC_PRODUCT_IMAGES_TOKEN` and `OC_PRODUCT_IMAGES_SIGNING_SECRET` marked secret, Functions scope only. Enabled flag and canonical origin use the same scope.
- Production and named QA alias `dsh-images-20261018` only. Generic deploy-preview values were removed; QA has a different server-only signing secret. No ordinary Firebase account/module grants, SEO credential changes or rule changes.
- Netlify CLI aliases use the branch context. The alias was redeployed after its isolated environment was set; only the final candidate above was verified. An initial unpublished-config alias candidate was superseded.

## Local and GitHub checks

- 23 endpoint/gallery checks passed, including actual rendered replacement/copy, preserved concurrent privacy edits, changed-source rejection, independent new hero preservation, bounded byte reads, strict projection and expiry/tampering.
- Actual Node wrapper/Admin SDK Firestore+Storage emulator integration passed; fictional files only, live writes forbidden by loopback guards.
- Full prebuild/build, standard no-undef lint, function packaging, Firebase login config checks and whitespace checks passed.
- Branch Actions `39046800701`: success. Main code Actions `39047403232`: success. Later dummy-example fix is documentation only.

## Candidate role gates — PASS

Fresh email/password sign-ins from signed-out dedicated QA tabs, with owner browser left untouched.

- Admin `claude-qa@crystocraft.com` → `/dashboard`, correct admin sidebar including Settings/Portal; figures 3 due / 20 Pipeline / 11 production / 13 orders. Refresh preserved admin shell. Range 297/297 products, 722 SKUs. No console errors.
- Approved customer `customer-qa@crystocraft.com` → `/shop` with QA-only company. Range 295 designs; Mini Butterfly Music Box detail loaded Chrome USD12.51 / Gold USD12.84, ~9 weeks/MOQ100. Refresh preserved customer shell/data. No admin/cost/internal-note controls; `/settings` redirected to `/shop`. No console errors. QA signed out.
- Served Firebase configuration probe HTTP200; real browser checks above independently proved sign-in.
- Screenshots candidate-admin.png and candidate-customer.png saved in the task artifact folder.

## Candidate live API — PASS, existing approvals only

- Requested OC product `RdoJsqdz9DU4qT4fDwUS` had ten explicitly Public, unbranded, owned Storage images before QA. No new Public setting or migration was applied.
- Anonymous/wrong-token list →401; POST →405 before operations; authenticated list →200, ten eligible images, explicit projection only.
- Signed primary-image download →200, 189029 bytes, matching returned MD5. The file was kept in memory only; no image saved locally or uploaded anywhere.
- Repeat listing retained identical image ID/content hash; tampered link →403.
- A genuinely issued link expired at 18 Oct 00:01:46 HKT; request at 00:04:02 HKT returned 410 EXPIRED_LINK. No clock or signing-secret manipulation.
- Netlify normalizes Cache-Control to `private,no-store`; download cache status reported durable bypass. Test accepts equivalent comma whitespace rather than requiring an exact header string.

## Production gates

PASS, independently checked after publication; no candidate session reused.

- Served production bundle `/assets/index-DEGyuWz6.js`; V8.18 · 18 Oct, 00:03 HKT. Public Firebase configuration probe HTTP200.
- Fresh admin email/password sign-in → `/dashboard`; Settings/Portal and correct admin shell. Reload passed. Range 297/297 products, 722 SKUs; no console errors.
- Fresh approved-customer email/password sign-in → `/shop`; QA-only customer shell. Range 295 designs; Mini Butterfly Music Box detail and reload passed, Chrome USD12.51 / Gold USD12.84, made to order ~9 weeks/MOQ100. No admin/cost/internal-note controls. Direct `/settings` navigation redirected to `/shop`; no console errors. Both QA accounts signed out.
- All eight production API checks passed: anonymous/wrong token401, POST405, authenticated lists200, generation-pinned download200 (189029 bytes, matching MD5), stable identities and tampered signature403. Ten existing eligible images returned for the requested product.
- Production role screenshots: production-admin.png and production-customer.png in the task artifact folder. DSH WordPress ingestion remains untested and was not performed.

## Data and rules boundary

The endpoint is GET-only and no QA script invoked a catalogue/WordPress write.
Existing target gallery metadata fingerprint matched its pre-release baseline exactly after production checks (ten images, ten pre-existing Public approvals).
Normal QA sign-ins may update login activity stamps. No images/products were
approved, published, created, activated or priced. No messages were sent to DSH;
only an owner-reviewable handoff draft will be prepared.
Firestore SHA256 `bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548` and Storage SHA256 `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c` unchanged/not deployed.
