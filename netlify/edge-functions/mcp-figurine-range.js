import { requireRole } from './lib/auth.js'
import { handleMcpFigurineRange } from './lib/mcpFigurineRange.js'

export default function handler(req) {
  return handleMcpFigurineRange(req, {
    authorize: request => requireRole(request, ['staff']),
    projectId: Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID'),
    // Deliberately off for phase one. A separate owner-approved configuration
    // change is required before even an approved:true tool call can write.
    writesEnabled: Deno.env.get('FIGURINE_MCP_WRITES_ENABLED') === 'true',
  })
}
