import { collection, doc, getDocsFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { sameFirestoreValue } from './firestoreValue'

export function corporateQuoteEditPatch(payload, form, tiers, original) {
  const changes = {}
  for (const key of Object.keys(form)) {
    if (!sameFirestoreValue(form[key], original.form[key])) changes[key] = payload[key]
  }
  if ('supplier_id' in changes) changes.supplier_name = payload.supplier_name
  if (!sameFirestoreValue(tiers, original.tiers)) changes.volume_tiers = payload.volume_tiers
  if (!sameFirestoreValue(payload.attachments, original.attachments)) changes.attachments = payload.attachments
  return changes
}

export async function saveCorporateSupplierQuote({
  productId, componentId, quoteId, data, originalAttachments, isOpen,
}) {
  const component = doc(db, 'products', productId, 'components', componentId)
  const quotes = collection(component, 'supplier_quotes')
  const target = quoteId ? doc(quotes, quoteId) : doc(quotes)

  await runTransaction(db, async tx => {
    const parent = await tx.get(component)
    if (!parent.exists()) throw new Error('This component could not be found. Reopen the product before saving.')
    const current = await tx.get(target)
    if (quoteId && !current.exists()) throw new Error('This supplier quote could not be found. Reopen the component before saving.')
    if (!quoteId && current.exists()) throw new Error('This quote was already saved. Reopen the component before adding it again.')
    if (quoteId && 'attachments' in data && !sameFirestoreValue(current.data().attachments || [], originalAttachments)) {
      throw new Error('Attachments changed in another session. Reopen this quote before saving.')
    }

    let formerPreferred = []
    if (data.is_preferred === true) {
      // Web transactions can read documents by reference. List after reading the
      // parent so every retry sees selections committed since the first attempt.
      const listed = await getDocsFromServer(quotes)
      const others = listed.docs.filter(quote => quote.id !== target.id && quote.data().is_preferred)
      formerPreferred = await Promise.all(others.map(quote => tx.get(quote.ref)))
    }
    if (!isOpen()) throw new Error('This quote editor is no longer open. Reopen the quote before saving.')

    // Touch the parent when choosing or clearing a preference. Two selections
    // for different quote IDs must contend on the same document version.
    if (data.is_preferred === true || (data.is_preferred === false && current.data()?.is_preferred)) {
      tx.update(component, { supplier_quote_preference_updated_at: serverTimestamp() })
    }
    for (const previous of formerPreferred) {
      if (previous.exists() && previous.data().is_preferred) tx.update(previous.ref, { is_preferred: false })
    }
    if (quoteId) tx.update(target, data)
    else tx.set(target, { ...data, createdAt: serverTimestamp() })
  })

  return target.id
}
