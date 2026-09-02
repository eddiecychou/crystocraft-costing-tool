// Credit Note API (Sales Return / Credit Note Phase C) — admin-gated, backed
// by Supabase public.app_credit_note. Same posture as uc.js: the browser
// never talks to Supabase directly, everything goes through this
// admin-verified edge function using the secret service-role key.
//
// The Firestore credit_notes/{id} doc is the editable WORKING record; this
// table only ever holds the posted financial FACT — see app_credit_note.sql's
// header for the full "why". Void is the only other write this API exposes;
// there is no "update a posted credit note" op, matching the invoice/UC
// posture (no in-place mutation of a permanent fact).
//
//   POST { op: 'post_credit_note', ... }  -> allocates cn_no, inserts the fact
//   POST { op: 'void_credit_note', id }   -> flips status to 'void'
//   POST { op: 'list_credit_notes', si_no?, order_id?, limit? }
import { requireModule } from './lib/auth.js'

const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const KEY = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !KEY) return json({ error: 'Server not configured' }, 500)

  const auth = await requireModule(req, 'credit_notes')
  if (!auth.ok) return auth.response
  const email = auth.email

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json', ...(init?.headers || {}) },
  })

  // ── post: allocate the CN number and the financial fact, atomically ───────
  if (body.op === 'post_credit_note') {
    const firestoreId = String(body.firestoreId ?? '').trim()
    if (!firestoreId) return json({ error: 'Missing firestoreId' }, 400)
    const lines = Array.isArray(body.lines) ? body.lines.slice(0, 200).map(l => ({
      item_code: String(l.item_code ?? '').slice(0, 100),
      description: String(l.description ?? '').slice(0, 500),
      qty_returned: Number(l.qty_returned) || 0,
      unit: String(l.unit ?? '').slice(0, 20),
      unit_price: Number(l.unit_price) || 0,
    })) : []
    const systemAmount = Number.isFinite(Number(body.system_amount)) ? Number(body.system_amount) : null
    const accountingAmount = Number.isFinite(Number(body.accounting_amount)) ? Number(body.accounting_amount) : systemAmount
    const adjustment = (accountingAmount != null && systemAmount != null)
      ? Math.round((accountingAmount - systemAmount) * 100) / 100 : null
    const adjustmentReason = String(body.adjustment_reason ?? '').trim().slice(0, 500)
    // No silent overwrite (SR-05, same rule as the invoice adjustment_total path).
    if (adjustment && Math.abs(adjustment) > 0.005 && !adjustmentReason) {
      return json({ error: 'Adjustment reason required', detail: 'accounting_amount differs from system_amount but no adjustment_reason was given' }, 400)
    }
    if (!lines.length) return json({ error: 'At least one line is required' }, 400)

    const r = await rest('rpc/allocate_credit_note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_firestore_id: firestoreId,
        p_customer: String(body.customer ?? '').slice(0, 200),
        p_channel: String(body.channel ?? '').slice(0, 40),
        p_currency: String(body.currency ?? 'HKD').slice(0, 8),
        p_order_id: body.order_id ? String(body.order_id).slice(0, 64) : null,
        p_uc_id: Number.isFinite(Number(body.uc_id)) && body.uc_id ? Number(body.uc_id) : null,
        p_uc_no: body.uc_no ? String(body.uc_no).slice(0, 64) : null,
        p_si_no: body.si_no ? String(body.si_no).slice(0, 64) : null,
        p_system_amount: systemAmount,
        p_accounting_amount: accountingAmount,
        p_adjustment_reason: adjustmentReason || null,
        p_disposition: body.disposition ? String(body.disposition).slice(0, 40) : null,
        p_reason: body.reason ? String(body.reason).slice(0, 100) : null,
        p_remarks: body.remarks ? String(body.remarks).slice(0, 4000) : null,
        p_lines: lines,
        p_record_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.record_date ?? '')) ? body.record_date : null,
        p_accounting_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.accounting_date ?? '')) ? body.accounting_date : null,
        p_marketplace_ref: body.marketplace_ref ? String(body.marketplace_ref).slice(0, 200) : null,
        p_created_by: email,
      }),
    })
    if (!r.ok) return json({ error: 'Posting failed', detail: (await r.text()).slice(0, 300) }, 502)
    const row = (await r.json())[0] || {}
    return json({ cn_no: row.o_cn_no, id: row.o_id })
  }

  // ── void: flip status, never delete ────────────────────────────────────────
  if (body.op === 'void_credit_note') {
    const id = parseInt(body.id, 10)
    if (!id) return json({ error: 'Missing id' }, 400)
    const r = await rest('rpc/void_credit_note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_voided_by: email }),
    })
    if (!r.ok) return json({ error: 'Void failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ ok: true })
  }

  // ── list: the register + the over-credit check (sum against one si_no/order) ─
  if (body.op === 'list_credit_notes') {
    const p = new URLSearchParams()
    p.set('select', '*')
    p.set('order', 'id.desc')
    p.set('limit', String(Math.min(Math.max(parseInt(body.limit, 10) || 200, 1), 1000)))
    if (body.si_no) p.set('si_no', `eq.${String(body.si_no).slice(0, 64)}`)
    if (body.order_id) p.set('order_id', `eq.${String(body.order_id).slice(0, 64)}`)
    const r = await rest(`app_credit_note?${p.toString()}`)
    if (!r.ok) return json({ error: 'List failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ rows: await r.json() })
  }

  return json({ error: `Unknown op: ${body.op}` }, 400)
}

export const config = { path: '/api/credit-note' }
