# V8.18 bulk marketing and blog AI response handling

Audit found bulk generation used only the first model text part, accepted unfinished candidates, and could exceed300characters when appending ellipsis. It now requests a structured marketing_description field, joins non-thought parts, requires STOP, validates nonempty strings, retries unusable replies and enforces the inclusive300limit. Bulk browser transport errors now show a friendly retry message instead of JSON parser details. Existing previews, individual approval, stale/instruction checks and atomic product_marketing_history backups unchanged.

Blog generation previously fell back only on HTTP failure, accepted unvalidated objects and exposed JSON.parse errors. It now uses a response schema, complete-candidate parsing, validates metadata/all5spotlight sections or every selected roundup product, and retries invalid/truncated/missing content. Failure produces a friendly JSON error. Spotlight/roundup browser paths validate before state changes and keep the current editable draft on failed regeneration. Switching products/source clears the old product's draft to avoid mismatching content. Section rewriting uses safe transport parsing and validates its body/heading before replacing the section; instructions remain on failure. No WordPress publish behavior/permissions changed.

Shared completedAiJson/limitAiCopy also cover the already-fixed product rewrite endpoint. Shared readAiResponse covers product/bulk/blog transports. Gemini blog output budget8192; thinking disabled for configured models consistently. No fabricated partial JSON repairs or positional acceptance of missing products. No live writes or external publication needed for QA.

Twelve new real-handler/component regressions plus existing103=115passed,0failed. Tests include malformed/truncated fallback, bad shape/empty reply, full blog content and product matching, both blog screens retaining drafts on errors and clearing them on changed products, section retry, bulk preview preservation/reapproval block, required approval and atomic backup. Full build9.40s, no-undef lint,11Firebase config tests and diff checks passed. CI edge-function path filters expanded to cover all affected AI helpers/handlers.

Candidate/production verification pending.

## Candidate checks — 16 October 2026, Australia/Sydney

Codecfe254c, deploy6ad0e0c88f13c0c055dd5d07, served /assets/index-DH7I6zdR.js, V8.18 ·16Oct01:18, Firebase probe200. Admin claude-qa@crystocraft.com fresh password login PASS: dashboard96pipeline/Settings access,294/294figurine products713SKUs before/after refresh. Real bulk review loaded140current products; one263-character preview for925SilverBrooch returned, saved249-character copy unchanged, approval unchecked, Save0disabled. No application/save attempted.

Live blog spotlight for the same product returned all5sections and valid metadata. Intro section rewrite completed correctly. Live two-product roundup returned both925SilverBrooch andCrystalBurgundyWineGlass with intro/conclusion and metadata. No runtime errors; no WordPress publish action. Unsaved blog QA tabs closed. Screenshots bulk-blog-candidate-{admin,bulk,spotlight,roundup}.png under /private/tmp/v818-evidence. Customer/production gates pending.

Candidate customer customer-qa@crystocraft.com fresh password login PASS: expected approved QA-only shop,24figurine cards before/after refresh, Sacred Angel detail/finish prices, no private/admin controls or runtime errors. /blog-generator redirected to /shop. Evidence bulk-blog-candidate-customer.png. Both QA sessions signed out; owner's working session preserved. Candidate PASS; production verification pending.

## Production checks — 16 October 2026, Australia/Sydney

Release9dafe97cddde90f57e438cb37e242c5374ab2636, deploy6ad0e1f1830c54d0a2eee040 published01:24:42AEDT. Both production hostnames serve /assets/index-C4WxnZnD.js, V8.18 ·16Oct01:24; both configuration probes200. GitHub Actions run38751001627/job116477060509 success; logs confirm115passed (39+9+6+19+17+25),0failed.

Admin claude-qa@crystocraft.com fresh password login PASS: dashboard96pipeline, Settings access,294/294products713SKUs before/after refresh. Live bulk review140products;925SilverBrooch preview224characters, original249characters unchanged, approval unchecked and Save0disabled. Real spotlight produced metadata/all5sections, real intro rewrite completed; real roundup contained both selected products (925SilverBrooch,CrystalBurgundyWineGlass), intro/conclusion and metadata. No runtime errors, no copy writes/approval/application or WordPress publish actions. Unsaved blog QA tabs closed. Evidence bulk-blog-production-{admin,bulk,spotlight,roundup}.png.

Customer customer-qa@crystocraft.com fresh real-page password login PASS: approved QA-only storefront,24figurine cards before/after refresh, Sacred Angel detail/finish prices, no private/admin controls or runtime errors. Both /blog-generator and /products/marketing-copy-bulk redirected to /shop. Evidence bulk-blog-production-customer.png. Both QA sessions signed out; owner's working session preserved. No rules, permissions or business-record changes. Production PASS. Closure skips Netlify to preserve the verified build.
