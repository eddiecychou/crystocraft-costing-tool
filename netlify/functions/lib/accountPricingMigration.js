export const PRIVATE_PRICING_FIELDS = ['corp_markup_override', 'pricing_group']
export function pricingMigrationPlan(user, existing = {}) {
  const fields = Object.fromEntries(PRIVATE_PRICING_FIELDS.filter(k => Object.hasOwn(user, k)).map(k => [k, user[k]]))
  for (const [key, value] of Object.entries(fields)) {
    if (Object.hasOwn(existing, key) && JSON.stringify(existing[key]) !== JSON.stringify(value)) throw Error('Conflicting private pricing destination; manual review required.')
  }
  return fields
}
export async function migrateAccountPricing(db, uid, { apply = false, deleteField, timestamp } = {}) {
  return db.runTransaction(async tx => {
    const userRef = db.doc('users/' + uid), privateRef = db.doc('account_pricing/' + uid)
    const [user, pricing] = await Promise.all([tx.get(userRef), tx.get(privateRef)])
    if (!user.exists) return false
    const fields = pricingMigrationPlan(user.data(), pricing.data())
    if (!Object.keys(fields).length) return false
    if (apply) {
      tx.set(privateRef, { ...fields, legacy_profile_pricing: fields, migratedAt: timestamp() }, { merge: true })
      tx.update(userRef, Object.fromEntries(Object.keys(fields).map(k => [k, deleteField()])))
    }
    return true
  })
}
