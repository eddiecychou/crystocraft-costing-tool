import { FieldValue } from 'firebase-admin/firestore'
import { validId } from './customerAccess.js'
// Admin-only caller. Re-read the company inside the same approval transaction;
// mirrored identity fields from a legacy signup are never accepted as authority.
export async function approveLegacyAccount(db, uid, customerId, patch = {}) {
  if (!validId(uid) || (customerId && !validId(customerId))) throw Object.assign(Error('Invalid account or customer.'), { status: 400 })
  await db.runTransaction(async tx => {
    const ref = db.doc('users/' + uid), snap = await tx.get(ref)
    if (!snap.exists) throw Object.assign(Error('Account not found.'), { status: 404 })
    const user = snap.data()
    if (user.invitation_id && user.status === 'pending') throw Object.assign(Error('Approve this account through its invitation.'), { status: 409 })
    const customerSnap = customerId ? await tx.get(db.doc('customers/' + customerId)) : null
    if (customerId && !customerSnap.exists) throw Object.assign(Error('Customer not found.'), { status: 404 })
    const customer = customerSnap?.data()
    tx.update(ref, { ...(patch.role === 'customer' ? { role: 'customer', modules: [] } : {}), status: 'approved', updatedAt: FieldValue.serverTimestamp(),
      customer_id: customerId || null, sensitive: customer?.sensitive === true,
      erp_code: customer?.erp_code || '', erp_code_shared: customer?.erp_code_shared === true,
      ...(customer?.company_name ? { company_name: customer.company_name } : {}),
    })
  })
}
