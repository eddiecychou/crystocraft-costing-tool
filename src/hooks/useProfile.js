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
export const isProduction = p => !!p && p.role === 'production'
// Any internal STAFF login (not a customer) — the set that lands in the
// operation-center app rather than the Storefront. Grows if more staff roles
// are added; keep it the single test for "is this one of our people".
export const isStaff      = p => isAdmin(p) || isProduction(p)
export const isApproved   = p => !!p && p.role === 'customer' && p.status === 'approved'
export const isPending    = p => !!p && p.role === 'customer' && p.status !== 'approved'
