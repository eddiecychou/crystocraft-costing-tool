// Pure candidate preparation. Never edits/deploys the checked-in false gate.
export function b0016ReleaseRules(source) {
  if(source.includes('function setupReleasePlan() {') && source.includes('request.resource.data.diff(p.design)') && !source.includes('b0016WritesApproved() && b0016ComponentCreate(componentId)')) return source
  const replace = (needle, value) => { if (!source.includes(needle)) throw Error('Rules source drift: '+needle); source=source.replace(needle,()=>value) }
  replace('function b0016WritesApproved() {\n      return false;\n    }',`function b0016WritesApproved() {
      let p = setupReleasePlan();
      return p.approved == true && p.service_principal == request.auth.uid
        && p.expires_at is timestamp && p.expires_at > request.time
        && p.expires_at <= request.time + duration.value(1, 'h');
    }
    function setupReleasePlan() {
      return get(/databases/$(database)/documents/range_mcp_approvals/b0016_setup_release).data;
    }`)
  const designStart=source.indexOf('    function b0016RangeCreate(rangeId) {')
  const designEnd=source.indexOf('    function b0016RangeLink(rangeId) {')
  if(designStart<0||designEnd<designStart)throw Error('Design validator source drift')
  source=source.slice(0,designStart)+`    function b0016RangeCreate(rangeId) {
      let p = setupReleasePlan();
      return isB0016Mcp() && rangeId == p.range_id
        && request.resource.data.diff(p.design).affectedKeys().hasOnly(['createdAt'])
        && request.resource.data.createdAt == request.time
        && getAfter(/databases/$(database)/documents/range_mcp_audit/$(p.design_audit_id)).data.request_hash == p.design.mcp_request_hash
        && request.resource.data.active == false && request.resource.data.status == 'concept'
        && b0016AllClaimsMatch(rangeId);
    }
`+source.slice(designEnd)
  replace('b0016WritesApproved() && (b0016RangeLink(rangeId) || colourRangeLink(rangeId))','b0016WritesApproved() && colourRangeLink(rangeId)')
  replace('match /range_products/{rangeId} {',`match /range_products/{rangeId} {
      allow get: if isB0016Mcp() && rangeId == setupReleasePlan().range_id
        && !exists(/databases/$(database)/documents/range_products/$(rangeId));`)
  replace("&& request.resource.data.item_code == itemCode\n        && request.resource.data.range_id.matches", "&& request.resource.data.item_code == itemCode\n        && request.resource.data.range_id == setupReleasePlan().range_id\n        && request.resource.data.createdAt == request.time\n        && request.resource.data.range_id.matches")
  replace("&& request.resource.data.action in [\n          'create_mezuzah_range_design', 'create_mezuzah_range_components'\n        ]",`&& request.resource.data.action == 'create_mezuzah_range_design'
        && auditId == setupReleasePlan().design_audit_id
        && request.resource.data.diff(setupReleasePlan().design_audit).affectedKeys().hasOnly(['at'])
        && request.resource.data.at == request.time
        && getAfter(/databases/$(database)/documents/range_products/$(setupReleasePlan().range_id)).data.mcp_request_hash == setupReleasePlan().design.mcp_request_hash`)
  replace('function colourPlanValid(p) {\n      return isB0016Mcp() && p.service_principal == request.auth.uid',`function colourPlanValid(p) {
      let release = setupReleasePlan();
      return isB0016Mcp() && p.service_principal == request.auth.uid
        && p.range_id == release.range_id
        && p.audit.request_id == release.bom_request_id
        && p.audit.request_hash == release.bom_hash`)
  replace("allow create: if b0016WritesApproved() && isB0016Mcp()\n        && auditId.matches", "allow create: if request.resource.data.action == 'create_mezuzah_range_design'\n        && b0016WritesApproved() && isB0016Mcp()\n        && auditId.matches")
  replace('allow create: if b0016WritesApproved() && colourAuditCreate(auditId);',"allow create: if request.resource.data.action == 'b0016_colour_bom' && b0016WritesApproved() && colourAuditCreate(auditId);")
  replace("allow create: if can('supply') || (b0016WritesApproved() && b0016ComponentCreate(componentId));","allow create: if can('supply');")
  replace("allow create: if can('supply') || (b0016WritesApproved() && b0016QuoteCreate(componentId, quoteId));","allow create: if can('supply');")
  replace('match /range_mcp_approvals/{auditId} {',`match /range_mcp_approvals/{auditId} {
      allow get: if isB0016Mcp() && auditId == 'b0016_setup_release'
        && (!exists(/databases/$(database)/documents/range_mcp_approvals/$(auditId)) || resource.data.service_principal == request.auth.uid);`)
  return source
}
