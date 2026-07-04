// Fire-and-forget transactional email trigger.
//
// Never blocks or throws into the caller: email is best-effort, and the real
// action (enquiry saved, signup created, account approved) has already
// succeeded before this runs. `keepalive` lets the request finish even if the
// page navigates away immediately after (e.g. approving then routing back).
export function notifyEmail(event, payload) {
  try {
    fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, payload }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* ignore — email must never break the user flow */ }
}
