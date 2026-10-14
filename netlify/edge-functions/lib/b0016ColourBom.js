// Fixed owner-reviewed codes; live creation remains gated by endpoint AND rules.
export const B0016_COLOURS = ['BK', 'BL', 'C1', 'MT', 'PE', 'VL']
export const B0016_METAL_CODE = 'FM-B0016BY00-G'
export const B0016_REUSE_ID = 'rc_mv7xu3mmayc5g'
export const B0016_FABRIC_CODES = B0016_COLOURS.map(code => `FM-CF003-${code}`)
export const B0016_PLAN_REVISION = 'fm-cf003-v2'
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

export async function prepareB0016ColourBom(input, ctx, api, retry = false) {
  const request_id = api.requestId(input.request_id)
  const parts = await api.source(ctx)
  for (const part of Object.values(parts)) {
    const name = part.supplier.name || part.supplier.name_cn || ''
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new Error('SOURCE_SUPPLIER_INVALID: supplier display name must be nonempty and at most 160 characters')
  }
  const existing = await api.get(ctx, `range_components/${B0016_REUSE_ID}`)
  if (!existing || existing.code !== (retry ? 'FM-CF003-C1' : 'P-CF003-C1')) throw new Error('REUSE_COMPONENT_CHANGED: exact C1 code does not match the expected pre-rename/retry state')
  // Do not replace an operator's independently assigned supplier/cost/quote.
  if (!retry && (existing.supplierId || existing.unit_cost != null || existing.preferred_quote_id || existing.tooling_sample_cost != null || existing.volume_tiers?.length))
    throw new Error('REUSE_COMPONENT_NEEDS_REVIEW: existing C1 already has supplier/cost/preferred quote data; no automatic overwrite')
  const quotes = await api.listReuseQuotes(ctx)
  if (!retry && quotes.length) throw new Error('REUSE_QUOTE_NEEDS_REVIEW: existing C1 supplier quotes require review before adding another')
  if (!retry && ((existing.stock_qty != null && existing.stock_qty !== 0) || (existing.reserved_qty != null && existing.reserved_qty !== 0) || existing.used_by?.length))
    throw new Error('C1_USAGE_REVIEW_REQUIRED: stock, reservations or usage hints block in-place rename')
  const designPreview = await api.designPreview(ctx, { item_codes: api.ITEM_CODES })
  let range = null
  if (input.range_id) {
    range = await api.get(ctx, `range_products/${api.id(input.range_id, 'range_id')}`)
    if (!range || range.design_no !== '0016' || range.format_code !== '000' || range.active !== false || range.status !== 'concept' || range.mcp_creator_uid !== api.RANGE_SERVICE_UID || api.usedSkus(range).length !== 6 || api.ITEM_CODES.some(code => !api.usedSkus(range).includes(code)))
      throw new Error('RANGE_NOT_B0016: use the inactive six-SKU B0016 design only')
    if (!retry && range.critical_components?.length) throw new Error('BOM_NOT_EMPTY: existing BOM requires review; preparation does not replace it')
  }
  const identity = await api.identity('b0016_colour_bom', request_id, {
    range_id: input.range_id || null, metal_code: B0016_METAL_CODE,
    fabric_codes: B0016_FABRIC_CODES, reuse_component_id: B0016_REUSE_ID,
    plan_revision: B0016_PLAN_REVISION, legacy_c1_action: 'rename_in_place_after_approval',
  })
  const range_id = input.range_id || '{approved_B0016_range_id}'
  const metadata = { mcp_creator_uid: api.RANGE_SERVICE_UID, mcp_range_id: range_id, mcp_request_id: request_id, mcp_request_hash: identity.hash, mcp_audit_id: identity.audit_id }
  const ids = B0016_COLOURS.map((code, i) => i === 2 ? B0016_REUSE_ID : `${identity.fabric_id}_${code.toLowerCase()}`)
  const quoteIds = B0016_COLOURS.map(code => `${identity.fabric_quote_id}_${code.toLowerCase()}`)
  const refs = [
    { id: identity.metal_id, code: B0016_METAL_CODE, qty_per_unit: 1, plating_code: 'G', all_variants: true },
    ...B0016_COLOURS.map((crystal_code, i) => ({ id: ids[i], code: B0016_FABRIC_CODES[i], qty_per_unit: 1, plating_code: '', all_variants: true, crystal_code })),
  ]
  const records = []
  const sourceRef = kind => ({ product_id: api.SOURCE_PRODUCT_ID, component_id: api.SOURCE_PARTS[kind].component_id, quote_id: api.SOURCE_PARTS[kind].quote_id })
  const quote = (kind, colour) => ({
    supplier_id: api.SOURCE_PARTS[kind].supplier_id,
    unit_cost: kind === 'metal' ? 11.30 : 9.00, unit_cost_currency: 'RMB',
    moq: kind === 'metal' ? 500 : 100, is_preferred: true,
    tooling_sample_cost: kind === 'metal' ? 2912 : null,
    tooling_sample_cost_currency: 'RMB', source_provenance: sourceRef(kind),
    ...(colour ? { crystal_code: colour, source_unit_cost: 8.10, source_unit_cost_currency: 'RMB', cost_basis: 'owner_conservative', moq_scope: 'per_colour', supplier_colour_confirmation: 'pending' } : {}),
    notes: kind === 'metal' ? 'Metal case only; no screws. One-time RMB 2,912 fee, shared across colours.' : 'Fabric panel only; supplier coverage of this exact colour code requires confirmation. Assembly and packaging excluded.',
    supplier_name: parts[kind].supplier.name || parts[kind].supplier.name_cn || '', volume_tiers: [], attachments: [], ...metadata,
  })
  const costMirror = (kind, quoteId) => ({ supplierId: api.SOURCE_PARTS[kind].supplier_id, supplierName: parts[kind].supplier.name || parts[kind].supplier.name_cn || '', preferred_quote_id: quoteId, unit_cost: kind === 'metal' ? 11.30 : 9.00, unit_cost_currency: 'RMB', tooling_sample_cost: kind === 'metal' ? 2912 : null, tooling_sample_cost_currency: 'RMB', volume_tiers: [] })
  records.push({ action: 'create', path: `range_components/${identity.metal_id}`, fields: { code: B0016_METAL_CODE, name: 'Mezuzah Metal Case', category: 'Metal Part', plating_code: 'G', notes: '', images: [], ...costMirror('metal', identity.metal_quote_id), ...metadata } })
  records.push({ action: 'create', path: `range_components/${identity.metal_id}/supplier_quotes/${identity.metal_quote_id}`, fields: quote('metal') })
  B0016_COLOURS.forEach((colour, i) => {
    const reuse = i === 2
    records.push({ action: reuse ? 'rename_code_and_cost_mirror_after_approval' : 'create', path: `range_components/${ids[i]}`, ...(reuse ? { precondition_update_time: existing.updateTime, old_code: 'P-CF003-C1', new_code: 'FM-CF003-C1', preserve_existing_fields: ['name', 'notes', 'images', 'stock_qty', 'reserved_qty', 'movements', 'createdAt'] } : {}), fields: { ...(!reuse ? { name: `Mezuzah Crystal Fabric Panel ${colour}`, category: '', plating_code: '', notes: '', images: [] } : {}), code: B0016_FABRIC_CODES[i], ...costMirror('fabric', quoteIds[i]), ...metadata } })
    records.push({ action: 'create', path: `range_components/${ids[i]}/supplier_quotes/${quoteIds[i]}`, fields: quote('fabric', colour) })
  })
  records.push({ action: 'update_only_critical_components', path: `range_products/${range_id}`, precondition_update_time: range?.updateTime, fields: { critical_components: refs } })
  records.push({ action: 'create', path: `range_mcp_audit/${identity.audit_id}`, fields: { action: 'b0016_colour_bom', service_principal: api.RANGE_SERVICE_UID, requested_by: 'unknown', request_id, request_hash: identity.hash, range_id, source_product_id: api.SOURCE_PRODUCT_ID, reused_component_id: B0016_REUSE_ID, component_ids: [identity.metal_id, ...ids], quote_ids: [identity.metal_quote_id, ...quoteIds], code_migration: { component_id: B0016_REUSE_ID, from_code: 'P-CF003-C1', to_code: 'FM-CF003-C1' } } })
  return {
    ok: true, dry_run: true, will_write: false, blocked: true, live_writes_enabled: false,
    request_id, request_hash: identity.hash, source_verified: true, plan_revision: B0016_PLAN_REVISION,
    migration: { component_id: B0016_REUSE_ID, from_code: 'P-CF003-C1', to_code: 'FM-CF003-C1', action: 'rename_in_place_after_approval', performed: false, record_id_preserved: true },
    approval_required: { path: `range_mcp_approvals/${identity.audit_id}`, provisioned: false, service_can_write_approval: false, requires_actual_range_id: !range, usage_review_max_age_minutes: 15, description: 'Separate owner review must approve the exact FM component/quote/BOM/audit plan and typed C1 before/after rename snapshot. A zero-reference/conflict/child-record usage attestation, at most 15 minutes old and matching C1 updateTime, is mandatory. This dry run creates no approval.' },
    warnings: [...designPreview.warnings,
      { code: 'LEGACY_COMPONENT_CODE_AUDIT_REQUIRED', message: 'Fresh privileged audit must confirm all seven FM codes unused and zero legacy C1 references, child records, stock or reservations before rename.' },
      { code: 'SUPPLIER_COLOUR_COVERAGE_REVIEW', message: 'Ryan source names do not map all six owner item-code colours. Proposed RMB 9 working costs are not confirmation of supplier colour availability.' },
      { code: 'PHASE_TWO_RULES_REQUIRED', message: 'Atomic writer implemented locally. Live writes remain disabled in both endpoint configuration and Firestore rules; separate approval and release required.' }],
    conflicts: designPreview.conflicts.filter(row => row.range_id !== input.range_id),
    proposed: { range_id, needs_range_design_creation: !range, new_components: 6, reused_components: 1, new_quotes: 7, records, critical_components: refs, variant_mapping: api.ITEM_CODES.map((sku, i) => ({ sku, metal: B0016_METAL_CODE, fabric: B0016_FABRIC_CODES[i], component_ids: [identity.metal_id, ids[i]], quantity_each: 1 })), screws: false, selling_price: null, price_publishing: false },
  }
}

// No arbitrary payload or paths: only the exact reviewed plan can be committed.
export async function createB0016ColourBom(input, ctx, api) {
  if (input.approved !== true || input.dry_run !== false) throw new Error('APPROVAL_REQUIRED: explicit approved:true and dry_run:false required')
  if (!ctx.writesEnabled) throw new Error('WRITES_DISABLED: live Figurine writes remain disabled')
  if (!ctx.legacyCodeAuditCertified) throw new Error('LEGACY_COMPONENT_CODE_AUDIT_REQUIRED: separately reviewed code audit required')
  if (!/^mcp_range_[a-f0-9]{32}$/.test(input.range_id || '')) throw new Error('INVALID_RANGE_ID: existing workflow-created B0016 range ID required')
  if (!/^[a-f0-9]{64}$/.test(input.expected_preview_hash || '')) throw new Error('PREVIEW_REQUIRED: supply the exact approved dry-run request_hash')
  if (input.acknowledge_supplier_colour_pending !== true) throw new Error('REVIEW_REQUIRED: supplier colour coverage remains pending; explicitly acknowledge before creation')
  const request_id = api.requestId(input.request_id)
  const ids = await api.identity('b0016_colour_bom', request_id, { range_id: input.range_id, metal_code: B0016_METAL_CODE, fabric_codes: B0016_FABRIC_CODES, reuse_component_id: B0016_REUSE_ID, plan_revision: B0016_PLAN_REVISION, legacy_c1_action: 'rename_in_place_after_approval' })
  if (ids.hash !== input.expected_preview_hash) throw new Error('PREVIEW_MISMATCH: preview is for different content/range')
  const priorAudit = await api.get(ctx, `range_mcp_audit/${ids.audit_id}`)
  if (priorAudit && priorAudit.request_hash !== ids.hash) throw new Error('DUPLICATE_REQUEST: UUID already used for different content')
  const preview = await prepareB0016ColourBom(input, ctx, api, Boolean(priorAudit))
  const records = preview.proposed.records
  const result = already_exists => ({ ok: true, created: !already_exists, already_exists, range_id: input.range_id, edit_url: `${ctx.origin}/range/${input.range_id}`, component_ids: records.at(-1).fields.component_ids, quote_ids: records.at(-1).fields.quote_ids, audit_ref: `range_mcp_audit/${ids.audit_id}`, screws: false, price_publishing: false })
  const complete = async () => {
    const actual = await Promise.all(records.map(record => api.get(ctx, record.path)))
    return actual.every((doc, i) => doc && Object.entries(records[i].fields).every(([key, value]) => equal(doc[key], value)))
  }
  if (priorAudit) {
    if (!await complete()) throw new Error('INCOMPLETE_PRIOR_REQUEST: component/quote/BOM/audit disagree; inspect, do not repair automatically')
    return result(true)
  }
  if (preview.conflicts.length) throw new Error('DUPLICATE_ITEM_CODE: conflicting or orphaned SKU claim')
  const approval = await api.get(ctx, `range_mcp_approvals/${ids.audit_id}`)
  const c1 = await api.get(ctx, `range_components/${B0016_REUSE_ID}`)
  const expectedApproval = approvalPlan(preview, c1, api.RANGE_SERVICE_UID)
  if (!approval || approval.approved !== true || Date.parse(approval.expires_at) <= Date.now()
    || Date.parse(approval.expires_at) > Date.now() + 60 * 60 * 1000
    || !Number.isFinite(Date.parse(approval.expires_at))
    || Object.entries(expectedApproval).some(([key, value]) => !equal(approval[key], value)))
    throw new Error('OWNER_PLAN_APPROVAL_REQUIRED: owner must separately approve this exact private plan, C1 snapshot, and code audit; service cannot approve itself')
  const review = approval.usage_review
  if (!review || review.reference_count !== 0 || review.code_conflict_count !== 0 || review.child_record_count !== 0
    || review.c1_update_time !== c1.updateTime || !Number.isFinite(Date.parse(review.checked_at))
    || Date.parse(review.checked_at) > Date.now() || Date.now() - Date.parse(review.checked_at) > 15 * 60 * 1000)
    throw new Error('C1_USAGE_REVIEW_REQUIRED: exact owner plan needs a fresh zero-reference/conflict/child-record audit matching the current C1 snapshot')
  // Detect partial/orphaned output before issuing any write.
  for (const record of records.filter(record => record.action === 'create')) {
    if (await api.get(ctx, record.path)) throw new Error('INCOMPLETE_PRIOR_REQUEST: planned ID exists without matching audit; review required')
  }
  let response
  try { response = await api.commitPlan(ctx, records) } catch {
    if (await complete()) return result(true)
    throw new Error('ATOMIC_WRITE_UNCONFIRMED: transport failed; verify state and retry same UUID, never use a new key')
  }
  if (!response.ok) {
    if (await complete()) return result(true)
    throw new Error(`${response.status === 403 ? 'PERMISSION_DENIED' : 'ATOMIC_WRITE_FAILED'}: atomic commit rejected; no partial commit; review and retry same UUID`)
  }
  if (!await complete()) throw new Error('WRITE_VERIFICATION_FAILED: post-read does not match requested bundle; review before retry')
  return result(false)
}

// Pure preparation: never persists an approval. Admin must review/provision it
// separately, with a short expiry, after fresh full-code and C1 quote audits.
export function approvalPlan(preview, existingC1, service_principal) {
  const components = {}, quotes = {}, quote_parents = {}
  for (const record of preview.proposed.records) {
    const path = record.path.split('/')
    if (path[0] !== 'range_components') continue
    if (path.length === 2) {
      const { id: _id, updateTime: _updateTime, ...before } = existingC1
      components[path[1]] = path[1] === B0016_REUSE_ID ? { ...before, ...record.fields } : record.fields
    } else { quotes[path[3]] = record.fields; quote_parents[path[3]] = path[1] }
  }
  const { id: _id, updateTime: _updateTime, ...c1_before } = existingC1
  return { service_principal, range_id: preview.proposed.range_id, refs: preview.proposed.critical_components,
    components, quotes, quote_parents, c1_before, audit: preview.proposed.records.at(-1).fields }
}
