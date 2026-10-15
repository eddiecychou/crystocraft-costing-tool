# V8.18 product AI writer: malformed JSON and duplicate guidance

Screenshot error matches a confirmed server defect: rewrite-section returned the model's raw text as application/json after parsing failed, causing the client res.json() to display an unterminated-string parser exception. It only used parts[0], did not check finishReason, and lacked a response schema. The exact provider finish reason for the old screenshot is not available; truncation/thinking consumption is a plausible cause, not asserted as observed.

The service now requests a response schema, excludes thought parts and joins all visible text, requires a completed STOP candidate with valid nonempty body and optional blog heading, and returns only validated serialized fields. Invalid/truncated responses fall back to the next configured model; exhaustion produces a friendly JSON error. Output budget is increased and thinking disabled consistently with the existing generate-marketing-copy path. The marketing 300-character backstop reserves space for its ellipsis. Authorization remains unchanged. Official API reference: https://ai.google.dev/api/generate-content.

Corporate ProductForm and RangeForm now share MarketingCopyEditor: one optional AI instructions field and one AI Write/AI Rewrite action determined by whether copy exists. Generated text is a draft preview with Use this copy / Discard. Current copy changes only after acceptance; publishing still requires the product save. Errors keep current copy and instructions. Client rejects non-JSON, empty, invalid-type, over-limit and failed-HTTP responses. Blog rewrite heading compatibility retained.

Thirteen new network-mocked real-handler/component regressions plus existing90 =103passed,0failed. Build8.30s, no-undef lint and diff checks pass. CI includes the new suite and both edge files in path triggers. Chrome local preview reproduced malformed JSON, confirmed preserved current copy/guidance, successful retry/approval and the same editor in both catalogue modes. Screenshot /private/tmp/v818-evidence/ai-writer-draft-preview.png. These are fixture tests, not a live Gemini test. No catalogue records edited.

Candidate verification pending; no main push/production release authorized for this new request yet. Follow docs/skills/RELEASE-WORKFLOW.md before publication.

## Candidate PASS — 16 October 2026 01:04 AEDT

Code7b1a8e7, deploy6ad0dc87eb4af88294d8fe6f, https://6ad0dc87eb4af88294d8fe6f--ua-product-manager.netlify.app; served /assets/index-NouaNP9d.js, V8.18 ·16Oct00:58; Firebase configuration probe200 and11config tests passed.

Admin claude-qa@crystocraft.com fresh real-page password login PASS: dashboard96pipeline/Settings access,294/294products713SKUs before/after refresh, no runtime errors. On an unsaved /products/new form, supplied QA glass name/spec and the screenshot's acoustic guidance. Real Gemini-backed /api/rewrite-section succeeded:272-character valid draft mentioning soft, low-pitched ringing when gently clinked; original61-character copy remained unchanged until acceptance. Draft discarded; product never created/saved. Actual candidate screenshot /private/tmp/v818-evidence/ai-writer-live-candidate.png, admin evidence ai-writer-candidate-admin.png.

Customer customer-qa@crystocraft.com fresh real-page password login PASS: approved QA-only storefront,24figurine cards before/after refresh, Sacred Angel detail/finish prices, no admin/cost controls or runtime errors. /products/new redirected to /shop. Screenshot ai-writer-candidate-customer.png. Both QA sessions signed out; owner working session preserved. Temporary local preview server stopped.

All103local/prebuild regressions passed; GitHub Actions changes are local and have not run remotely. Candidate is ready for production approval. No main push, production deployment, catalogue record writes, rules or permission changes. Production remains the previously verified packing/PO release. Obtain explicit owner release approval under RELEASE-WORKFLOW.md line58, then push main, wait for Git CD/CI and repeat both fresh production-role gates plus real AI rewrite before closure.

## Production PASS — 16 October 2026 01:10 AEDT

Owner explicitly approved production publication in the follow-up request. Pushed acc40296b6db5fbb228ad3bf6c1193fc8e611184 to main; Netlify deploy6ad0ddc0170a8e038f6a72b9 published01:06:49AEDT. Both portal.crystocraft.com and ua-product-manager.netlify.app serve /assets/index-DXKLlJXT.js, V8.18 ·16Oct01:06; both configuration probes200. GitHub Actions run38748366170/job116467887968 success; logs confirm103passed (39search/filter+9quote PDF+6quote Excel+19invoice+17packing/PO+13AI writer),0failed.

- Admin claude-qa@crystocraft.com fresh real-page password sign-in on published Netlify production origin PASS: expected dashboard96pipeline/Settings access,294/294products713SKUs before/after refresh and no runtime errors. Real production AI rewrite on an unsaved new-product form used the screenshot's acoustic guidance and supplied glass facts. Returned264-character valid draft with soft, low-pitched ring; original61-character copy remained unchanged during preview. Use this copy placed the264-character draft into the form correctly. No product creation/save or catalogue write occurred. Evidence ai-writer-production-admin.png and ai-writer-production-rewrite.png under /private/tmp/v818-evidence.
- Customer customer-qa@crystocraft.com fresh real-page password sign-in PASS: expected approved QA-only storefront,24figurine cards before/after refresh, Sacred Angel detail/finish prices, no private admin/cost controls or runtime errors. /products/new redirected to /shop. Evidence ai-writer-production-customer.png.

Both QA sessions signed out; owner working custom-domain session preserved. No business-record, rules, account/profile or permission changes. Closure documentation uses [skip netlify] so the verified app build remains served.
