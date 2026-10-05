import { requireModule } from './lib/auth.js'
import { handleCreateCorpGiftWithQuote } from './lib/corpGiftWithQuote.js'

export default function handler(req) {
  return handleCreateCorpGiftWithQuote(req, {
    authorize: requireModule,
    projectId: Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID'),
  })
}
