// Privileged reads stay behind a verified Firebase identity and a current role.
export const privateJson = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
    'Netlify-CDN-Cache-Control': 'no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' },
})
export const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/')
export async function customerContext(req, { verifyToken, getProfile, getCustomer }) {
  const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if (!token || token.length > 8192) throw Object.assign(Error('Please sign in.'), { status: 401 })
  let uid
  try { uid = (await verifyToken(token)).uid } catch { throw Object.assign(Error('Please sign in again.'), { status: 401 }) }
  if (!validId(uid)) throw Object.assign(Error('Please sign in again.'), { status: 401 })
  const profile = await getProfile(uid)
  if (profile?.role !== 'customer' || profile.status !== 'approved') throw Object.assign(Error('Approved customer account required.'), { status: 403 })
  const customer = validId(profile.customer_id) ? await getCustomer(profile.customer_id) : null
  return { uid, profile, customer, customerId: customer ? profile.customer_id : '' }
}
export function customerDependencies(db, auth) {
  return {
    verifyToken: token => auth.verifyIdToken(token, true),
    getProfile: async uid => (await db.doc('users/' + uid).get()).data(),
    getCustomer: async id => (await db.doc('customers/' + id).get()).data(),
  }
}
