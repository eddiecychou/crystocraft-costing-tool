import { requireModule } from './lib/auth.js'
import { handleMcpCatalogue } from './lib/mcpCatalogue.js'

export default function handler(req) {
  return handleMcpCatalogue(req, {
    authorize: requireModule,
    projectId: Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID'),
  })
}
