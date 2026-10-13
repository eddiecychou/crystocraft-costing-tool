import { requireModule } from './lib/auth.js'
import { handleMcpProductSupply } from './lib/mcpProductSupply.js'

export default function handler(req) {
  return handleMcpProductSupply(req, {
    authorize: requireModule,
    projectId: Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID'),
  })
}
