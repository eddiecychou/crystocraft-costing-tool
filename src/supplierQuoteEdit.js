import { sameFirestoreValue } from './firestoreValue'

export function supplierQuoteEditPatch(payload, form, tiers, original) {
  const changes = {}
  for (const key of Object.keys(form)) {
    if (!sameFirestoreValue(form[key], original.form[key])) changes[key] = payload[key]
  }
  if ('supplier_id' in changes) changes.supplier_name = payload.supplier_name
  if (!sameFirestoreValue(tiers, original.tiers)) changes.volume_tiers = payload.volume_tiers
  if (!sameFirestoreValue(payload.attachments, original.attachments)) changes.attachments = payload.attachments
  return changes
}
