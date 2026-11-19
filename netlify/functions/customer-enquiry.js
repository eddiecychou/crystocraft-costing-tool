import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {initAdminApp} from './lib/firebaseAdmin.js'
import {saveCustomerEnquiry, enquiryErrorResponse} from './lib/customerEnquiry.js'

const json = (data, status) => Response.json(data, {status, headers:{'Cache-Control':'private, no-store'}})

export default async function customerEnquiry(req) {
  if (req.method !== 'POST') return json({error:'Method not allowed'}, 405)
  const token = (req.headers.get('authorization') || '').match(/^Bearer (\S+)$/i)?.[1]
  if (!token) return json({error:'Sign in required'}, 401)
  try { initAdminApp() } catch { return json({error:'Enquiry service unavailable'}, 503) }
  let uid
  try { uid = (await getAuth().verifyIdToken(token, true)).uid } catch { return json({error:'Sign in required'}, 401) }
  let body
  try {
    const text = await req.text()
    if (Buffer.byteLength(text) > 1024*1024) return json({error:'This enquiry is too large. Please split the selections.'}, 413)
    body = JSON.parse(text)
    if (!body || typeof body !== 'object') throw new Error()
  } catch { return json({error:'Invalid enquiry'}, 400) }
  try { return json(await saveCustomerEnquiry(getFirestore(), uid, body), 200) }
  catch (e) { const result = enquiryErrorResponse(e); return json({error:result.error}, result.status) }
}
export const config = {path:'/api/customer-enquiry'}
