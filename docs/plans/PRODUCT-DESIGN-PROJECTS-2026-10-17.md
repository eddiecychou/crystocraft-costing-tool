# Product Design Projects — local implementation for review

**Not deployed. No live project records/imports, rules deployment, app deployment, publication or new MCP.** Work is isolated on `codex/product-design-projects`; the original dirty checkout is untouched.

## Operator workflow

Product Design opens `/design/projects`. Active includes waiting work; Waiting is derived from Awaiting feedback or a non-empty waiting-on field, excluding held/completed/archived work. Group by real customer; internal projects need no fake customer. The list sorts by last update, supports search and customer/status views, and retains projects whose customer lookup is missing or inaccessible using the saved name/ID. Each customer can have multiple design deliverables.

Create a project with a title only. Add current state and next action when known. Brief, project type, waiting-on, image and up to four typed reference links are optional. Existing permitted HTTPS image URLs can be entered; no upload. Internal OC links are generated from a stable record ID, and external links require HTTPS without embedded credentials. Unknown suppliers/prices/records remain blank.

Open a project to edit its overview, append a dated note, or archive/unarchive through the editor. All revisions preserve previous and new overview snapshots and actor/time in immutable history. History pages 50 entries at a time with Load older updates. Corrections append rather than erase; no hard delete or bulk import UI exists. Concurrent edits require reopening, and stable update IDs make retries idempotent without overwriting later work.

Customer Summary & To-do is linked for personal reminders when the viewer has customer access. Next action is a design step, not a second task database. Design completion changes neither customer Pipeline nor order status nor catalogue publication/approval.

## Agent update handoff

Open Edit / apply agent update → Paste an agent update. Use:

```text
Current state: The revised artwork is ready for scale review.
Next action: Compare the physical sample with the drawing.
Waiting on: Supplier dimensions
Decision: Keep the silver finish; no publication requested.
```

Apply to draft fills the local editor only; review and Save project. Omitted headings preserve existing fields, an empty Waiting on clears it, and Decision becomes the appended history note. No new agent credentials or MCP write access are provided. Routine corrections do not require a catalogue-approval flow; catalogue writes retain their own controls.

## Existing routes and data boundaries

- `/design` redirects to Projects. The old orientation page remains `/design/tools`.
- `/design/products` still contains the approved-concept gallery and supplier-grouped sources; its existing detail/edit/template/spec-sheet links remain. Templates, JSON editors, generations and catalogue routes are unchanged.
- Only new `pd_projects/{id}` and immutable `/updates/{eventId}` are written. No product, component, supplier, customer, pricing, gallery or concept writes occur as a side effect.
- Existing `product_design` capability gates routes and rules. PD-only staff can use projects even if separate customer lookup is denied; no CRM permissions are added. Customer, anonymous, unrelated staff and modules-empty MCP identities have no project access.
- Rules validate root schema and limits, creator/time immutability, revision increments, actor/request time, typed links and atomic history snapshots. The four-reference limit was chosen and tested to stay within Firestore rule evaluation limits; customer association is separate.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for private Product Design records through existing module permissions, validated bounded fields and immutable atomic history. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

## Draft starting list — no import

See `PRODUCT-DESIGN-PROJECTS-DRAFT-2026-10-17.json`: BMW VIP gifts, existing B0016 mezuzah, WestK silver pin, La Salle luggage belt. Each entry has a proposed stage, next action, repository source and explicit confirmation points. Images and unverified product/supplier IDs are blank. Three customer IDs are references from the earlier 17 October read-only CRM review and require fresh validation before import. Mezuzah ownership is deliberately unresolved (internal Range vs AIA).

The registry is not treated as live truth. The detailed mezuzah outcome supersedes its old create-blocked registry row; the belt outcome contains both a saved v5 asset and an earlier create-v5 next step. No stale create instruction was carried forward. Private GitHub links need the viewer's own access; local unpushed evidence may be absent remotely.

## QA and release boundary

- Pure validation/filter/grouping/agent parsing and real-component regressions: `npm run test:design-projects` (also in prebuild and existing GitHub Actions workflow).
- Local transaction/rules tests: `qa/pd-projects-emulator.mjs`, guarded to require a loopback Firestore emulator. Existing RBAC, merge and Pipeline regressions also run. Only fictional emulator records are written.
- Fictional browser harness: `node qa/pd-projects-preview.mjs` → `http://127.0.0.1:5194`; `/mobile.html` supplies a 375px iframe. Mock APIs cannot access Firebase. `--build-only` refreshes the files for an existing local server.
- Before any future release: owner approval, reviewed draft import decisions, production build and full rules checks, separately authorised rules deployment, exact candidate plus production fresh admin/customer login gate. No production role/login verification is claimed for this undeployed feature.

Final verification results and screenshots are recorded after the final checks.

## Final local verification — PASS (17 October 2026)

- Production build and final bundle: PASS. Existing large-chunk build advisory remains; no missing imports/parse failures. No-undef lint and diff whitespace checks: PASS. Firebase public configuration tests: 11 PASS (no deployed login claim).
- Prebuild: 491 checks/tests (263 Node tests including 11 new project regressions, plus 228 standalone existing checks). Relevant helper/UI/route/draft tests re-run after final UI edits: 11 PASS.
- Local emulators: 112 existing Firestore/Storage access assertions PASS; 11 new project transaction/access/history scenarios PASS; 7 customer-merge and 7 Pipeline scenarios PASS. This includes four internal/external references, trusted images, full 52-entry history paging, exact idempotent retries, changed-retry rejection, concurrency, immutable creator/audit, stale revision rejection, invalid fields/URLs and customer/anonymous/unrelated-staff/MCP denial. No existing rule block remains modified.
- Real local browser pass against the actual new components with fictional data and a mocked API that cannot connect to Firebase: customer/internal and Waiting filters, missing-image layout, internal creation with optional blanks, detail reopen, apply agent update then save, dated note append retaining earlier decisions, edit/cancel, existing tool links, empty/missing record, and runtime checks. No application runtime errors in the fresh final tab. Existing React Router future-flag warnings in the fixture are unrelated advisories.
- Desktop: viewport/content both 1280px. Phone iframe: overview, detail and new editor each measured viewport/content 375px with 0px horizontal overflow. Mobile tool navigation compacted to keep projects central. All screenshots inspected locally; do not mistake fictional fixture state for imported projects.
- Evidence directory: task-local `product-design-projects-2026-10-17/{projects-desktop,projects-phone,project-detail,project-editor,project-detail-phone,project-editor-phone}.png`. Draft list: `draft-project-list.html` in the same directory; generated from the review-only JSON using `qa/render-pd-project-drafts.mjs`.
- Original dirty checkout remains unchanged: porcelain SHA-256 `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`. New implementation remains local in the isolated worktree. No push, live import, app/rules deployment or product/customer change occurred. Only read-only database-edition inspection touched the live Firebase service; it confirmed the existing default STANDARD instance.

## Approval needed next

1. Review the four proposed projects and correct current states/ownership. B0016 ownership (internal Range or AIA) is specifically unresolved.
2. Separately authorise app/rules release. Candidate and production fresh admin/customer sign-ins must pass under `RELEASE-WORKFLOW.md`; this local test does not substitute for those gates.
3. Separately approve the exact project list before any live import. No importer or background sync has been enabled, and approving deployment alone must not import this draft file.
