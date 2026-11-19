import { doc, getDoc, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
export async function loadAccountPricing(uid) {
  return (await getDoc(doc(db, 'account_pricing', uid))).data() || {}
}
export async function updateAccountWithPricing(uid, patch, pendingAccount) {
  const publicPatch = { ...patch }, privatePatch = {}
  for (const field of ['corp_markup_override', 'pricing_group']) {
    if (Object.hasOwn(publicPatch, field)) {
      privatePatch[field] = publicPatch[field]
      delete publicPatch[field]
    }
  }
  const userRef = doc(db, 'users', uid)
  function write(writer) {
    if (Object.keys(privatePatch).length) writer.set(doc(db, 'account_pricing', uid), { ...privatePatch, updatedAt: serverTimestamp() }, { merge: true })
    writer.update(userRef, { ...publicPatch, updatedAt: serverTimestamp() })
  }
  if (pendingAccount) {
    return runTransaction(db, async tx => {
      const user = (await tx.get(userRef)).data()
      const changed = 'This request has changed. Refresh to see the current decision.'
      if (!user || user.status !== pendingAccount.status || user.invitation_id !== pendingAccount.invitation_id)
        throw new Error(changed)
      if (user.invitation_id) {
        const invitation = (await tx.get(doc(db, 'portal_invitations', user.invitation_id))).data()
        if (invitation?.status !== 'claimed' || invitation.claimed_uid !== uid) throw new Error(changed)
      }
      write(tx)
    })
  }
  const batch = writeBatch(db)
  write(batch)
  await batch.commit()
}
