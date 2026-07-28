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
`id=d952115846`).

### DEPLOYED (2026-07-28): mirror snippet, not a new form

The popup is Mailchimp's classic embedded form — `#mc-embedded-subscribe-form`
with `#mce-EMAIL` (name `EMAIL`) + a hidden `b_*` honeypot — already in the DOM
on every page. Rather than add a competing form, a **mirror** was deployed: an
invisible listener that captures the SAME signups the popup collects and
forwards each to `/api/subscribe`. Zero UX change, true parallel run.

Lives in **Elementor → Custom Code**, snippet "App signup mirror (parallel to
Mailchimp)" (post id 57615), Location `<head>`, Condition Entire site. The code:

```html
<script>
(function () {
  var ENDPOINT = 'https://ua-product-manager.netlify.app/api/subscribe';
  document.addEventListener('submit', function (e) {
    try {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      var act = form.getAttribute('action') || '';
      var isMC = form.id === 'mc-embedded-subscribe-form' || act.indexOf('list-manage.com') !== -1;
      if (!isMC) return;
      var el = form.querySelector('input[type=email], #mce-EMAIL, input[name=EMAIL]');
      var email = el && el.value ? el.value.trim() : '';
      if (!email || email.indexOf('@') < 0) return;
      var hp = form.querySelector('input[name^="b_"]');   // Mailchimp honeypot
      if (hp && hp.value) return;
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, page: location.href, source: 'wordpress_mc_popup' }),
        keepalive: true,
        mode: 'cors'
      }).catch(function () {});
    } catch (err) {}
  }, true); // capture phase, runs even if Mailchimp stops propagation
})();
</script>
```

Verified end-to-end on the live site: a submit on a list-manage form is caught,
posted, and lands in `marketing_contacts` (CORS from crystocraft.com confirmed).

### The replacement popup — BUILT, saved as DRAFT (ready, inactive)

The mirror only works while Mailchimp's popup exists (it listens to that popup's
form). So a standalone replacement popup was built and is waiting: **Elementor →
Custom Code, "App signup popup (activate at Mailchimp cutover)" (post id 57616),
status DRAFT.** It's a self-contained, on-brand modal (dark header, gold tagline,
burgundy button) that posts directly to `/api/subscribe` (source
`wordpress_popup`) with a honeypot and a 30-day "seen" cookie, no Mailchimp
dependency. Verified: renders correctly and a submit lands in `marketing_contacts`.

### Cutover checklist (when ready to drop Mailchimp)

Order matters so the site is never left with two popups or none:
1. **Remove the hosted Mailchimp popup snippet** (stops the Mailchimp popup).
   Its injection point still needs locating — `plugins.php`/code areas are
   blocked by the Plugin Sentinel security plugin.
2. **Publish the draft popup** (post 57616): set status Publish + Condition
   "Entire site", Location `<head>`.
3. **Unpublish the mirror** (post 57615) — redundant once Mailchimp's popup is
   gone (harmless if left; it just has nothing to listen to).

The mirror never touched Mailchimp — it only forwarded a copy — so nothing
breaks during the transition.
