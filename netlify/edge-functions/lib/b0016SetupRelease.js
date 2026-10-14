// Candidate release entrypoint helper; not imported by the live endpoint yet.
// The private, expiring owner control is a kill switch, not an IAM grant.
import { handleMcpFigurineRange, decode, RANGE_SERVICE_UID } from './mcpFigurineRange.js'
import { readLimitedJson } from './corpGiftDraft.js'
export const B0016_SETUP_CONTROL = 'range_mcp_approvals/b0016_setup_release'
export function setupRequestApproved(control, body, now = Date.now()) {
  const expires = Date.parse(control?.expires_at)
  if (!control?.approved || control.service_principal !== RANGE_SERVICE_UID || !Number.isFinite(expires) || expires <= now || expires > now + 60*60*1000) return false
  if (body?.input?.approved !== true || body?.input?.dry_run !== false) return false
  if (body.op === 'create_mezuzah_range_design') return body.input.request_id === control.design_request_id
  if (body.op === 'create_mezuzah_colour_bom') return body.input.request_id === control.bom_request_id && body.input.range_id === control.range_id && body.input.expected_preview_hash === control.bom_hash
  return false // Legacy two-component writer remains disabled.
}
export async function handleB0016SetupRelease(req, { authorize, projectId, fetchImpl = fetch }) {
  const auth = await authorize(req)
  if (!auth.ok) return auth.response || Response.json({ok:false,error:{code:'PERMISSION_DENIED',message:'Service identity required'}},{status:403})
  let body
  try { body = await readLimitedJson(req.clone()) } catch { body = null }
  let approved = false
  if (auth.uid === RANGE_SERVICE_UID && auth.role === 'staff' && ['create_mezuzah_range_design','create_mezuzah_colour_bom'].includes(body?.op)) {
    const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${B0016_SETUP_CONTROL}`,{headers:{Authorization:req.headers.get('authorization')}})
    if (response.ok) {
      const doc = await response.json()
      const control = Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v])=>[k,decode(v)]))
      approved = setupRequestApproved(control,body)
    }
  }
  // Fail before any catalogue read/write for an unapproved write request.
  if (body?.op?.startsWith('create_') && !approved) return Response.json({ok:false,error:{code:'WRITES_DISABLED',message:'No active owner approval for this exact B0016 request'}},{status:403,headers:{'Cache-Control':'no-store'}})
  return handleMcpFigurineRange(req,{authorize:async()=>auth,projectId,fetchImpl,writesEnabled:approved,legacyCodeAuditCertified:approved})
}
