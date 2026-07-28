# `/api/subscribe` — WordPress signup → app

Public endpoint that writes newsletter signups into the `marketing_contacts`
Firestore collection (the same store the Mailchimp export was imported into).
This is the live-feed half of retiring Mailchimp; see
`migration/import_marketing_contacts.cjs` for the one-time backfill and the
memory note `marketing-contacts-store` for the whole picture.

## What it does

- Upserts by email (same id rule as the import), so a signup **converges on the
  same doc** as an already-imported contact — never a duplicate.
- Non-destructive: only touches the fields it sets, so it never overwrites the
  Mailchimp data on an existing contact.
- Respects the suppression list: an `unsubscribed`/`cleaned` contact who
  re-signs is recorded (`resubscribe_requested_at`) but **not** auto-resurrected
  onto the emailable list — a human reviews it.
- New contacts land as `audience: ['website']`, `status: subscribed`,
  `source_import: 'wordpress_signup'`.
- Honeypot field `hp` — any value = treated as a bot, accepted silently, nothing
  written.

## Required Netlify env vars (server-side)

`VITE_FIREBASE_PROJECT_ID` already exists (erp.js uses it). Add two more, from
`firebase-service-account.json`:

| Var | Value |
|---|---|
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-fbsvc@crystocraft-costing.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | the `private_key` value from the JSON (keep the `\n`s — the function converts them) |

Optional: `SUBSCRIBE_ALLOWED_ORIGINS` (CSV) to override the default CORS allow-list
(`https://www.crystocraft.com`, `https://crystocraft.com`).

The service account already has Firestore write access (verified against live
Firestore). No IAM change needed.

## Test after deploy

```bash
curl -sS -X POST https://<app-domain>/api/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"test+1@example.com","first_name":"Test","company":"Acme"}'
# -> {"ok":true,"id":"test+1@example.com","created":true,"suppressed":false}
```

Then check **Marketing → Contacts** (filter audience = "Website signup").

## WordPress side (the parallel run)

The current popup is Mailchimp's own hosted snippet posting straight to
`list-manage.com` (account `u=6b2d62335af3c423419365717`, audience
`id=d952115846`). To run in parallel, add a form that posts to **both** — the app
endpoint and Mailchimp — so nothing breaks while you confirm the app is
capturing everything. Drop this into an Elementor HTML widget / header-footer
snippet (replace `APP_DOMAIN`):

```html
<form id="cc-subscribe">
  <input type="email" name="email" placeholder="Your email" required>
  <!-- honeypot: hidden from humans, bots fill it -->
  <input type="text" name="hp" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off">
  <button type="submit">Subscribe</button>
  <span class="cc-msg" aria-live="polite"></span>
</form>
<script>
document.getElementById('cc-subscribe').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, email = f.email.value.trim(), msg = f.querySelector('.cc-msg');
  if (f.hp.value) return;                       // bot
  // 1) app endpoint (source of truth going forward)
  try {
    await fetch('https://APP_DOMAIN/api/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, page: location.href }),
    });
  } catch (_) {}
  // 2) Mailchimp in parallel (remove this block once you cut over)
  try {
    const body = new URLSearchParams({ EMAIL: email });
    await fetch('https://crystocraft.us3.list-manage.com/subscribe/post?u=6b2d62335af3c423419365717&id=d952115846',
      { method: 'POST', mode: 'no-cors', body });
  } catch (_) {}
  msg.textContent = 'Thanks — you’re subscribed!';
  f.reset();
});
</script>
```

When you're confident the app is capturing everything, delete the Mailchimp
`<script>` block (step 2) and remove the hosted Mailchimp popup snippet. Where
that popup snippet is injected still needs locating — the `plugins.php`/code
area is blocked by the Plugin Sentinel security plugin.
