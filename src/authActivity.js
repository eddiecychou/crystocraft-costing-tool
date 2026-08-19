import { doc, updateDoc, serverTimestamp, increment } from 'firebase/firestore'
import { db } from './firebase'

// Best-effort activity stamp for admin follow-up (PortalLogins.jsx's roster).
// Self-update (leaves role/status/pricing untouched, so the rules allow it);
// never blocks the caller's sign-in flow. Call this after EVERY path that
// signs a user in directly (signInWithEmailAndPassword) — Login.jsx's normal
// sign-in and SetPassword.jsx's post-setup sign-in both qualify.
export function stampLogin(uid) {
  updateDoc(doc(db, 'users', uid), {
    last_login_at: serverTimestamp(),
    login_count: increment(1),
  }).catch(() => {})
}
