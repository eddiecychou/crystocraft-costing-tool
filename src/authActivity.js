import { doc, updateDoc, serverTimestamp, increment } from 'firebase/firestore'
import { db, auth } from './firebase'

// Best-effort last-seen stamp for PortalLogins.jsx's roster. Fired from
// useAuthState's onAuthStateChanged for every real auth transition (fresh
// sign-in AND restored session).
//
// Two things this has to survive, both of which used to lose ~60% of customer
// stamps silently (2026-09-10 audit: 26 of 43 customers had an Auth sign-in
// with no doc stamp):
//   1. The token race — onAuthStateChanged can fire a tick before the
//      Firestore SDK has the ID token wired to its connection, so the write
//      goes out unauthenticated and 403s. `getIdToken()` first forces the
//      token to be ready.
//   2. A transient permission-denied / offline blip — one delayed retry.
// The firestore.rules self-update path now also has a dedicated
// affectedKeys().hasOnly(['last_login_at','login_count']) clause, so an
// unrelated odd field on the doc can't deny the stamp either.
export async function stampLogin(uid) {
  const write = () => updateDoc(doc(db, 'users', uid), {
    last_login_at: serverTimestamp(),
    login_count: increment(1),
  })
  try {
    // Wait for a valid token to be attached to the SDK's connection.
    if (auth.currentUser) { try { await auth.currentUser.getIdToken() } catch { /* fall through */ } }
    await write()
  } catch {
    await new Promise(r => setTimeout(r, 1500))
    try { await write() } catch { /* give up — never block the sign-in flow */ }
  }
}
