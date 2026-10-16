# Simple Crystocraft Range product entry

Owner preference (16 October 2026): support direct OC entry and agent entry equally. Keep it simple, review the result, correct the existing product when something is wrong, and record reusable lessons. Do not add a separate approval queue or ask for confirmation of every optional field.

## In OC

Crystocraft Range → **New product** opens Quick Add. Enter name, design/format, confirmed overall size **with units**, description, offered finish rows and colour chips. Add images and only the supply-critical components that matter. **Show more fields** reveals optional marketing/links, packing and crystal recipes without losing entered data. New Quick Add saves remain hidden Concept and unpriced even if hidden field values are stale; it opens the saved product immediately for review. Finish pricing and publication later in the normal editor.

An existing design/format cannot be created twice. The error offers **Open existing product** so corrections happen in place. Existing products retain the full editor and current prices, media and inventory; Quick Add never reclassifies an existing product. Normal manual OC saves retain normal authenticated staff/admin permissions. The separate MCP write switch does not turn off ordinary OC editing.

## With the agent

Send one brief in normal language; no JSON or component IDs required from the owner:

> Product name/design/format; drawing/photos; confirmed overall dimensions and units; offered finishes and colour chips; selected critical parts with quantity/applicability; any special factual or marketing notes. Leave pricing to me.

The agent reads this workflow, the source drawing/owner corrections, current Range settings and the existing family/component library. Search exact design/format/full code first. Resolve exact existing component IDs/codes, propose an explicit missing part only when its definition is confirmed, and use one finish row with chips. Do not add every minor BOM item, quotes or a costing formula.

Gather the supplied facts once. Ask **one consolidated question** for genuinely blocking facts or contradictions (especially partial vs overall dimensions, finish scope and exact component identity). Do not repeatedly ask about blank optional marketing, packing, prices or stock. Never invent missing measurements or availability. Keep uncertainty visible instead of treating a guess as a fact.

Use `prepare_range_upload` for one complete read-only preview. Explain it to the owner in a short readable summary: product identity, overall dimensions, finishes/chips, selected parts/quantities, missing facts and exactly which fields would change. Include whether this is create or correction; expose no credentials. The owner need not learn JSON, token hashes or CLI commands.

**Current release condition: MCP live writes remain disabled until the owner approves an actual product preview.** A general instruction to simplify the process is not product approval. After explicit approval, an authorized operator performs the exact-preview approval and separately authorized write-window steps in `mcp/range/README.md`; the agent commits with the same token/approval/UUID and reads it back. Never bypass the switch or expand the identity to admin. No automatic publication.

Check the saved family once against the brief and the actual OC form. If a fact is wrong, get the current version and prepare a bounded correction to the **same family**. Preserve unrelated images, prices, stock and newer fields. Do not recreate the family or silently erase history. Retry uncertain outcomes with the original token/key rather than creating a second request.

Record a reusable, evidence-based lesson in the repository workflow/lessons when it prevents recurrence: what was wrong, the owner-confirmed correction, and the rule to apply next time. Example: overall width must not be replaced by wheelbase; coach dimensions are not defaults for other products. Do not copy client secrets/private supplier information into lessons. Do not update personal memory without an explicit request.

No real product is created merely to test this workflow. Use disposable emulator fixtures for saves, then view-only checks in production.
