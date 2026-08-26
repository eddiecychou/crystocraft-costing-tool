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
export function useAuthState() {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u)
      if (u) stampLogin(u.uid)
    })
  }, [])

  return user
}
