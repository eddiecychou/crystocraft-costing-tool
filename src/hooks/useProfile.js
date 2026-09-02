import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

// Loads the users/{uid} role doc for the signed-in user.
// Returns { profile, loading } where profile is:
//   { role: 'admin' | 'customer', status: 'pending' | 'approved',
//     base_currency, ws_discount_pct, company, contact, email }
// profile is null while loading, or {missing:true} if no doc exists yet.
export function useProfile(user) {
  const [profile, setProfile] = useState(undefined) // undefined = loading

  useEffect(() => {
    if (user === undefined) { setProfile(undefined); return }   // auth still resolving
    if (user === null)      { setProfile(null); return }        // signed out
    setProfile(undefined)
    return onSnapshot(
      doc(db, 'users', user.uid),
      snap => setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : { missing: true }),
      () => setProfile({ missing: true, error: true }),
    )
  }, [user])

  return { profile, loading: profile === undefined }
}

export const isAdmin      = p => !!p && p.role === 'admin'
// V8.14 — the flat internal role; access is p.modules[] (see src/access.js).
export const isStaffRole  = p => !!p && p.role === 'staff'
// Legacy fixed roles — kept for the migration shim only (src/access.js
// resolveModules). Remove once the two live accounts are converted.
export const isProduction = p => !!p && p.role === 'production'
export const isSales      = p => !!p && p.role === 'sales'
// Any internal STAFF login (not a customer) — the set that lands in the
// operation-center app rather than the Storefront. Grows if more staff roles
// are added; keep it the single test for "is this one of our people".
//
// ⚠️ NAME COLLISION, DIFFERENT MEANING: `firestore.rules` / `storage.rules`
// also define `isStaff()`, but there it's admin + production ONLY (the
// SUPPLY-side wall — sales is deliberately excluded from suppliers, POs,
// crystals, BOM cost, …). This client `isStaff` is the wider "any internal
// login" set. Do NOT reason about one from the other; when you touch either,
// check you're not folding `sales` onto the supply side. (Code review, V8.13.)
export const isStaff      = p => isAdmin(p) || isStaffRole(p) || isProduction(p) || isSales(p)
export const isApproved   = p => !!p && p.role === 'customer' && p.status === 'approved'
export const isPending    = p => !!p && p.role === 'customer' && p.status !== 'approved'
