import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { stampLogin } from '../authActivity'

// One stamp per real auth transition, which onAuthStateChanged fires for
// BOTH a fresh interactive sign-in AND a restored/persisted session
// (Firebase Auth's default browserLocalPersistence means a customer who
// never explicitly signs out stays "signed in" indefinitely — the common
// case). Login.jsx/SetPassword.jsx used to call stampLogin() themselves
// right after signInWithEmailAndPassword, which only ever covered the
// fresh-sign-in case: a returning customer who just reopens the portal
// with an existing session never re-typed a password, so those call sites
// never fired for them — reported live, 2026-08-27 ("I have some
// customers signed in but it is not shown in the activity"). Centralizing
// here covers both cases from one place, and removes the double-count
// those call sites would otherwise cause (onAuthStateChanged ALSO fires
// right after a fresh sign-in).
// Tags every GA4 hit with the signed-in Firebase uid (2026-08-27) — a
// pseudonymous id, not PII, same posture GA4's own docs describe for
// User-ID reporting. Without this, ga-portal-activity.js's traffic panel
// could only ever show aggregate site-wide numbers with no way to tell
// which visits belonged to which account (see that panel's own caption).
// Cleared on sign-out so the next anonymous visitor in the same browser
// doesn't inherit the previous user's id. window.gtag is defined by the
// inline snippet in index.html, unconditionally on every environment
// (including local dev) — guarded here only in case that script is ever
// blocked or removed.
//
// TWO separate GA4 calls, not one — `user_id` is a RESERVED field name
// (GA4's own built-in cross-device User-ID feature) and cannot also be
// registered as a custom dimension under that exact name — GA4's console
// rejects it ("User property name is not allowed", hit live 2026-08-27
// trying to register it). `app_uid` is a genuinely custom user property
// with the same value, registered separately (Admin > Custom definitions >
// Create custom dimension, scope User, parameter `app_uid`) — THAT is what
// the Data API can actually query per account. Keep both: user_id still
// benefits from GA's native User-ID reporting/deduplication, app_uid is
// what makes ga-portal-activity.js's future per-account breakdown possible.
function setGaUser(uid) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('set', { user_id: uid || null })
    window.gtag('set', 'user_properties', { app_uid: uid || null })
  }
}

export function useAuthState() {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u)
      setGaUser(u?.uid)
      if (u) stampLogin(u.uid)
    })
  }, [])

  return user
}
