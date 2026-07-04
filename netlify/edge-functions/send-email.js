// Transactional email via Resend (https://resend.com).
// Client posts a semantic event; this function owns the templates and decides
// which message(s) to send, so no email markup ever lives in the browser.
//
// POST body: { event, payload }
//   event 'enquiry'          → customer confirmation + admin alert
//   event 'account_approved' → customer "you're approved"
//   event 'signup'           → customer confirmation + admin alert
//
// Env (Netlify site vars, server-side only):
//   RESEND_API_KEY  — required
//   MAIL_FROM       — e.g. "Crystocraft <noreply@crystocraft.com>" (default resend test sender)
//   MAIL_ADMIN      — where admin alerts go (e.g. sales@crystocraft.com)
//   PORTAL_URL      — customer portal base URL (default https://portal.crystocraft.com)

const BRAND = '#6E2433'   // Bespoke burgundy
const GOLD  = '#C6A664'

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
))

// Minimal, email-safe shell (inline styles; no external fonts).
const shell = (heading, bodyHtml) => `
<div style="margin:0;padding:24px;background:#F7EEE3;font-family:Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E9E8E6;">
    <div style="background:#1C1C1A;padding:18px 24px;">
      <span style="color:#fff;font-size:18px;letter-spacing:3px;font-weight:bold;">CRYSTOCRAFT</span>
      <span style="color:${GOLD};font-size:11px;letter-spacing:2px;display:block;margin-top:2px;">PRODUCT PORTAL</span>
    </div>
    <div style="padding:28px 24px;">
      <h1 style="font-size:19px;color:#222;margin:0 0 16px;font-weight:normal;">${heading}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 24px;border-top:1px solid #E9E8E6;color:#888;font-size:11px;">
      Crystocraft — craftsmanship that catches the light, since 1958.
    </div>
  </div>
</div>`

const p = t => `<p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 14px;">${t}</p>`
const btn = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:11px 22px;font-size:13px;letter-spacing:1px;">${esc(label)}</a>`

function itemsTable(items = []) {
  if (!items.length) return ''
  const rows = items.map(i =>
    `<tr>
       <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;">${esc(i.name || i.code || '—')}</td>
       <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${esc(i.qty ?? '')}</td>
     </tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
    <tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;font-size:11px;color:#888;">ITEM</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;font-size:11px;color:#888;">QTY</th></tr>
    ${rows}
  </table>`
}

export default async function handler(req) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!API_KEY) return json({ error: 'RESEND_API_KEY not configured', skipped: true }, 200)

  const FROM       = Deno.env.get('MAIL_FROM')     || 'Crystocraft <onboarding@resend.dev>'
  const ADMIN      = Deno.env.get('MAIL_ADMIN')    || ''
  const REPLY_TO   = Deno.env.get('MAIL_REPLY_TO') || ADMIN   // where customer replies land
  const PORTAL_URL = Deno.env.get('PORTAL_URL')    || 'https://portal.crystocraft.com'

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const { event, payload = {} } = body || {}

  // Build the list of messages to send for this event.
  const msgs = []
  const name    = payload.contact_name || payload.company_name || 'there'
  const company = payload.company_name || payload.email || 'a customer'

  if (event === 'enquiry') {
    if (payload.email) msgs.push({
      to: payload.email,
      subject: 'We’ve received your enquiry — Crystocraft',
      html: shell('Thank you for your enquiry', [
        p(`Dear ${esc(name)},`),
        p('We’ve received your enquiry and our team will review it and get back to you shortly. No payment is taken at this stage.'),
        itemsTable(payload.items),
        payload.estimated_total ? p(`<b>Estimated total:</b> ${esc(payload.currency || '')} ${esc(payload.estimated_total)}`) : '',
        p('Thank you for considering Crystocraft.'),
      ].join('')),
    })
    if (ADMIN) msgs.push({
      to: ADMIN,
      subject: `New enquiry — ${company}`,
      html: shell('New enquiry received', [
        p(`<b>Company:</b> ${esc(payload.company_name || '—')}<br><b>Contact:</b> ${esc(payload.contact_name || '—')}<br><b>Email:</b> ${esc(payload.email || '—')}`),
        itemsTable(payload.items),
        payload.estimated_total ? p(`<b>Estimated total:</b> ${esc(payload.currency || '')} ${esc(payload.estimated_total)}`) : '',
        btn(`${PORTAL_URL}/portal`, 'Open Portal'),
      ].join('')),
    })
  } else if (event === 'account_approved') {
    if (payload.email) msgs.push({
      to: payload.email,
      subject: 'Your Crystocraft account is approved',
      html: shell('Your account is approved', [
        p(`Dear ${esc(name)},`),
        p('Your Crystocraft portal account has been approved. You can now sign in to view wholesale pricing and submit enquiries.'),
        btn(`${PORTAL_URL}/login`, 'Sign in'),
      ].join('')),
    })
  } else if (event === 'signup') {
    if (payload.email) msgs.push({
      to: payload.email,
      subject: 'Thanks for registering — Crystocraft',
      html: shell('Registration received', [
        p(`Dear ${esc(name)},`),
        p('Thanks for registering with the Crystocraft portal. Your account is awaiting approval — we’ll review it and email you once your pricing access is enabled.'),
      ].join('')),
    })
    if (ADMIN) msgs.push({
      to: ADMIN,
      subject: `New portal signup — ${company}`,
      html: shell('New portal signup', [
        p(`<b>Company:</b> ${esc(payload.company_name || '—')}<br><b>Contact:</b> ${esc(payload.contact_name || '—')}<br><b>Email:</b> ${esc(payload.email || '—')}`),
        p('Review and approve them in the portal.'),
        btn(`${PORTAL_URL}/portal`, 'Open Portal'),
      ].join('')),
    })
  } else {
    return json({ error: `Unknown event: ${event}` }, 400)
  }

  // Customer-facing mail replies to sales; admin alerts reply to the customer.
  for (const m of msgs) m.replyTo = m.to === ADMIN ? (payload.email || REPLY_TO) : REPLY_TO

  // Send them all; report per-message result without failing the whole call.
  const results = await Promise.all(msgs.map(async m => {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: m.to, subject: m.subject, html: m.html,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        }),
      })
      if (!r.ok) return { to: m.to, ok: false, status: r.status, detail: (await r.text()).slice(0, 200) }
      return { to: m.to, ok: true }
    } catch (e) {
      return { to: m.to, ok: false, error: String(e?.message || e) }
    }
  }))

  return json({ ok: results.every(r => r.ok), sent: results })
}
