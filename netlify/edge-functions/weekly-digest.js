import { requireModule } from './lib/auth.js'
import { weeklyDigest } from './lib/weeklyDigest.js'
export default async function handler(req) {
  if(req.method !== 'POST') return new Response('Method not allowed',{status:405})
  const auth=await requireModule(req,'customers')
  if(!auth.ok) return auth.response
  return weeklyDigest(req,Deno.env.get('DEEPSEEK_API_KEY'))
}
export const config={path:'/api/weekly-digest'}
