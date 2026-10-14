import { requireRole } from './lib/auth.js'
import { handleB0016SetupRelease } from './lib/b0016SetupRelease.js'

export default function handler(req) {
  return handleB0016SetupRelease(req, {
    authorize: request => requireRole(request, ['staff']),
    projectId: Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID'),
    // No environment write switch: exact expiring owner controls gate writes.
  })
}
