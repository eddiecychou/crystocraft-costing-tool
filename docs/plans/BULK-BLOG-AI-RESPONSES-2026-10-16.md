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
