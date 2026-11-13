export class OrderRequestError extends Error {
  constructor(message, status = 409, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const permitted = (profile, key) =>
  profile?.role === 'admin' ||
  (profile?.role === 'staff' &&
    Array.isArray(profile.modules) &&
    profile.modules.includes(key))

export function requirePermission(profile, module) {
  if (!permitted(profile, module))
    throw new OrderRequestError('Access denied.', 403)
}

export async function shippingProfile(db, tx, uid) {
  const profile = (await tx.get(db.collection('users').doc(uid))).data()
  requirePermission(profile, 'shipping')
  return profile
}
