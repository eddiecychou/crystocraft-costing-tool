// Revised exact-plan preparation ONLY. No live operation/permission is added.
import { B0016_COLOURS, B0016_REUSE_ID, B0016_METAL_CODE, B0016_FABRIC_CODES } from './b0016ColourBom.js'
export const B0016_FM_FABRIC_CODES = B0016_FABRIC_CODES

export async function reviseB0016FmPlan(previous, audit, makeIdentity) {
  if (!previous?.ok || previous.will_write !== false) throw Error('DRY_RUN_REQUIRED: valid write-free source preview required')
  if (!audit?.read_only || audit.production_writes !== 0) throw Error('USAGE_AUDIT_REQUIRED: privileged read-only C1/conflict audit required')
  const legacy = audit.legacy_c1
  const clear = legacy?.exists && legacy.fields?.code === 'P-CF003-C1'
    && legacy.update_time === previous.proposed.records[6].precondition_update_time
    && audit.reference_count === 0 && !(legacy.fields.used_by?.length)
    && !Object.values(legacy.child_counts || {}).some(n => n > 0)
    && [legacy.fields.unit_cost, legacy.fields.tooling_sample_cost].every(v => v == null)
    && !legacy.fields.supplierId && !legacy.fields.preferred_quote_id
    && [legacy.fields.stock_qty, legacy.fields.reserved_qty].every(v => v == null || v === 0)
  // Safe default if used elsewhere: keep old C1 intact and propose a separate FM record.
  const action = clear ? 'rename_in_place_after_approval' : 'preserve_legacy_create_separate_after_approval'
  const identity = await makeIdentity('b0016_fm_colour_bom', previous.request_id, {
    plan_revision: 'fm-cf003-v2', range_id: previous.proposed.needs_range_design_creation ? null : previous.proposed.range_id,
    metal_code: B0016_METAL_CODE, fabric_codes: B0016_FM_FABRIC_CODES,
    legacy_c1_action: action, legacy_component_id: B0016_REUSE_ID,
  })
  const result = structuredClone(previous), refs = result.proposed.critical_components
  const ids = [identity.metal_id, ...B0016_COLOURS.map(c => c === 'C1' && clear ? B0016_REUSE_ID : `${identity.fabric_id}_${c.toLowerCase()}`)]
  const quoteIds = [identity.metal_quote_id, ...B0016_COLOURS.map(c => `${identity.fabric_quote_id}_${c.toLowerCase()}`)]
  refs.forEach((ref, i) => { ref.id = ids[i]; ref.code = i === 0 ? B0016_METAL_CODE : B0016_FM_FABRIC_CODES[i - 1] })
  result.proposed.records.find(record => record.path.startsWith('range_products/')).fields.critical_components = refs
  for (let i = 0; i < 7; i++) {
    const component = result.proposed.records[i * 2], quote = result.proposed.records[i * 2 + 1]
    component.path = `range_components/${ids[i]}`; quote.path = `${component.path}/supplier_quotes/${quoteIds[i]}`
    component.fields.code = refs[i].code; component.fields.preferred_quote_id = quoteIds[i]
    if (i === 3) {
      if (clear) {
        component.action = 'rename_code_and_cost_mirror_after_approval'
        component.old_code = 'P-CF003-C1'; component.new_code = 'FM-CF003-C1'
        component.preserve_existing_fields = component.preserve_existing_fields.filter(k => k !== 'code')
      } else {
        component.action = 'create'; delete component.precondition_update_time; delete component.preserve_existing_fields
        Object.assign(component.fields, { name: 'Mezuzah Crystal Fabric Panel C1', category: '', plating_code: '', notes: '', images: [] })
      }
    }
    for (const record of [component, quote]) Object.assign(record.fields, { mcp_request_id: previous.request_id, mcp_request_hash: identity.hash, mcp_audit_id: identity.audit_id })
  }
  const auditRecord = result.proposed.records.at(-1)
  auditRecord.path = `range_mcp_audit/${identity.audit_id}`
  Object.assign(auditRecord.fields, { action: 'b0016_fm_colour_bom', request_id: previous.request_id, request_hash: identity.hash,
    reused_component_id: clear ? B0016_REUSE_ID : null, component_ids: ids, quote_ids: quoteIds,
    code_migration: { legacy_component_id: B0016_REUSE_ID, from_code: 'P-CF003-C1', to_code: 'FM-CF003-C1', action } })
  result.proposed.variant_mapping.forEach((v, i) => { v.fabric = B0016_FM_FABRIC_CODES[i]; v.component_ids = [ids[0], ids[i + 1]] })
  Object.assign(result.proposed, { new_components: clear ? 6 : 7, reused_components: clear ? 1 : 0 })
  result.request_hash = identity.hash; result.plan_revision = 'fm-cf003-v2'
  result.migration = { action, performed: false, ...auditRecord.fields.code_migration, record_id_preserved: clear,
    audit_checked_at: audit.checked_at, downstream_references: audit.references, limitations: audit.limitations }
  result.conflicts = [...result.conflicts, ...audit.exact_code_conflicts.map(c => ({ ...c, reason: 'EXISTING_COMPONENT_CODE' }))]
  Object.assign(result.approval_required, { path: `range_mcp_approvals/${identity.audit_id}`, provisioned: false,
    description: 'Revised FM proposal only. Requires separate owner approval, refreshed usage/conflict audit, updated writer and narrowly tested rename rules. The P-code plan/hash is superseded and must not be enabled.' })
  result.warnings = result.warnings.filter(w => !['PHASE_TWO_RULES_REQUIRED','LEGACY_COMPONENT_CODE_AUDIT_REQUIRED'].includes(w.code))
  result.warnings.push({ code: 'FM_CODE_PLAN_REVIEW_REQUIRED', message: 'This revised plan is not connected to a write operation. Do not enable the prior P-code writer. Approve the migration strategy before updating writer/permissions.' },
    { code: 'FRESH_USAGE_AUDIT_REQUIRED', message: 'Audit is a snapshot, not a lock. Repeat all FM code/conflict and old C1 usage checks immediately before an approved migration.' })
  return result
}
