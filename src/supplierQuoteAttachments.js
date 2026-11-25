import { runTransaction } from 'firebase/firestore'
import { sameFirestoreValue } from './firestoreValue'
import { db } from './firebase'

export function hasUnchangedQuoteTerms(original, form, tiers) {
  return original && sameFirestoreValue(form, original.form) && sameFirestoreValue(tiers, original.tiers)
}

export function saveQuoteAttachments(quoteRef, originalAttachments, attachments, { validateContext, isOpen }) {
  return runTransaction(db, async tx => {
    if (validateContext) await validateContext(ref => tx.get(ref))
    const latest = await tx.get(quoteRef)
    if (!isOpen()) throw new Error('This quote editor is no longer open. Reopen the quote before saving.')
    if (!latest.exists() || !sameFirestoreValue(latest.data().attachments || [], originalAttachments)) {
      throw new Error('Attachments changed in another session. Reopen this quote before saving.')
    }
    tx.update(quoteRef, { attachments })
  })
}
