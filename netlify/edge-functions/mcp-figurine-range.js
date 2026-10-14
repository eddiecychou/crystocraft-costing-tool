import { requireRole } from './lib/auth.js'
import { handleMcpFigurineRange } from './lib/mcpFigurineRange.js'

export default function handler(req) {
  return handleMcpFigurineRange(req, {
    authorize: request => requireRole(request, ['staff']),
    projectId: Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID'),
    // Hard-disabled in this release, even if an environment variable is true.
    // Enabling live writes requires a separately approved code + rules release.
    writesEnabled: false,
  })
}
