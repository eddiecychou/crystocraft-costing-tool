import { auth } from './firebase'

// Fire-and-forget transactional email trigger.
//
// Never blocks or throws into the caller: email is best-effort, and the real
// action (enquiry saved, account approved) has already succeeded before this
// runs. `keepalive` lets the request finish even if the page navigates away
// immediately after (e.g. approving then routing back).
//
// send-email.js requires a signed-in caller (V8.6 security fix — see
// PROJECT-PLAN.md) and derives the actual recipient server-side, so this
// just needs to attach the caller's own ID token; `payload` carries business
// context only (items, uid to act on, etc), never the send-to address.
export async function notifyEmail(event, payload) {
  try {
    const token = await auth.currentUser?.getIdToken?.()
    if (!token) return
    fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event, payload }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* ignore — email must never break the user flow */ }
}
