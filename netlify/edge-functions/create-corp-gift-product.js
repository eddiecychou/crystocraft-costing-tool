import { requireModule } from './lib/auth.js'
import { handleCreateCorpGiftProduct } from './lib/corpGiftDraft.js'

export default function handler(req) {
  return handleCreateCorpGiftProduct(req, {
    authorize: requireModule,
    projectId: Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID'),
  })
}
