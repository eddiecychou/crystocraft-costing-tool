// Daily Drafts re-engagement engine (V8.0) — turns an OWNER-APPROVED master
// message (composed + refined beforehand via draft-outreach-topic.js and
// discuss-outreach-draft.js — see src/marketing/DailyDrafts.jsx's Compose
// phase) and a pre-filtered candidate list into 10-20 personalized
// plain-text outreach emails for human review. Admin-triggered, no cron —
// same "a human clicks a button" posture as send-campaign.js.
//
// This is no longer product-shaped: earlier versions took a `product` and
// asked DeepSeek to draft an email introducing it from scratch per
// candidate. Now the owner already wrote and approved the actual message
// (any topic — a product, a portal invite, "just checking in") BEFORE
// anyone is targeted; this function's per-candidate step is
// PERSONALIZATION of that approved text, not drafting from scratch.
//
// This function does NOT touch Firestore. Candidate eligibility (crm_status,
// cooldown, blockOutreachUntil, prior Interaction Log history for this exact
// topic) is computed client-side in DailyDrafts.jsx from data the browser
// can already read under the existing rules — the same split Campaigns.js
// uses (it builds segments client-side, the edge function only does the
// part that needs a secret). Once this returns, the browser writes the
// outreach_drafts docs itself via domain/outreachDrafts.js.
//
// POST { master: { subject, body }, topicLabel: string,
//        candidates: [{ id, name, email, crm_category, crm_status, notes,
//                        erp_code, country, source?, previouslyContactedAt?,
//                        emailSummary?: { summary, recent_activity, open_commitments },
//                        whatsappSummary?: { summary, recent_activity, open_commitments },
//                        alibabaSummary?: { summary, recent_activity, open_commitments } }],
//        historicalHints?: string, targetingNote?: string }
//   emailSummary — V8.1 email ingestion's DeepSeek-generated read of the
//     customer's actual email history (customers/{id}.email_summary,
//     generated on-demand from CustomerDetail.jsx — see
//     refresh-email-summary.js). Only present for a `customer` candidate
//     that's had a summary generated; marketing_contacts never has one
//     (email ingestion matches customers.contacts[], not contacts).
//     Genuine correspondence, so it outranks the CRM `notes` free-text
//     field where the two disagree — see buildCustomerContext().
//   whatsappSummary — V8.2 WhatsApp ingestion's own equivalent
//     (customers/{id}.whatsapp_summary, see refresh-whatsapp-summary.js).
//     Same posture as emailSummary — real correspondence, outranks notes —
//     and same customer-only scope (WhatsApp leads saved under
//     marketing_contacts never reach this function; see
//     DailyDrafts.jsx's customerToEntity comment).
//   alibabaSummary — Alibaba Messages' own equivalent (customers/{id} and
//     marketing_contacts/{id}.alibaba_summary, generated from the pasted
//     alibaba_threads subcollection). Same posture as whatsappSummary — real
//     correspondence, outranks notes — but available for BOTH customers and
//     marketing_contacts, since Alibaba paste is not customer-only the way
//     email/WhatsApp ingestion is.
//   -> { drafts: [{ customerId, customerEmail, customerName, customerContext,
//                    fitScore, fitReason, draftSubject, draftBody, source }] }
//
// historicalHints — a short client-computed summary of recent skip/send
// outcomes (domain/outreachDrafts.js's listRecentDecisions(), summarized in
// DailyDrafts.jsx), folded into the fit-score prompt as one more paragraph of
// context. This is prompt-engineering, not fine-tuning — DeepSeek has no
// memory or training hook available here; each generate run is still
// stateless, it's just told what happened recently.
//
// targetingNote — free text the owner types on the Target card, e.g. "I
// want to interact with Crystocraft distributors in Europe". Treated as a
// STRONG steering instruction in the fit-score prompt (unlike
// historicalHints' "soft guidance") — a candidate that plainly doesn't match
// gets scored near 0 rather than just nudged down, since the whole point of
// typing this is to narrow today's batch, not gently bias it. Left blank,
// scoring just runs on topic/candidate fit alone — DeepSeek picks on its own
// judgment, same as always.
//
// previouslyContactedAt — set client-side only for candidates the owner
// explicitly chose to re-include despite an existing Interaction Log entry
// for this exact topic ("Include people already contacted about this" on
// the Target card). When present, the personalization step is told to write
// a reminder/follow-up, not repeat the original pitch.
//
// Env (Netlify site vars, server-side only):
//   DEEPSEEK_API_KEY       — required
//   SUPABASE_URL / SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) — the
//     same ERP-mirror creds erp.js already uses, for the purchase-history pull
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for admin-token verification
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'
import { buildMemoryBlock } from './lib/draftMemory.js'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

async function isFrontOffice(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  // V8.13: front-office — admin OR sales (see lib/auth.js requireFrontOffice)
  return ['admin', 'sales'].includes(doc?.fields?.role?.stringValue)
}

// Hard ceilings independent of what the client sends — protects DeepSeek rate
// limits and this function's own running time even if a bug ever asks for a
// larger candidate pool than intended.
const MAX_CANDIDATES = 80
const TOP_N = 20
const SCORE_CHUNK = 10

// One DeepSeek JSON-mode call. Single model (unlike the Gemini functions'
// flash/pro fallback list — DeepSeek doesn't have an equivalent tier to fall
// back to), with one retry on failure/empty response before giving up.
async function callDeepSeek(apiKey, { system, user, temperature, maxTokens }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature,
          max_tokens: maxTokens,
        }),
      })
      if (!res.ok) continue
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) continue
      return JSON.parse(text)
    } catch { /* try again, or fall through to null below */ }
  }
  return null
}

// Fit-score deprioritization (V8.9) — the owner observed most sent drafts go
// to marketing_contacts leads, which almost never carry real interaction
// data (a live check found 3/2635 with any notes, 0/2635 with an email or
// WhatsApp summary — those pipelines only ever write to customers/, see
// email-sync/sync.py and refresh-email-summary.js). DeepSeek was scoring
// these candidates with the same confidence as a customer with real
// history, because nothing told it the difference. This is a DETERMINISTIC
// penalty applied after the model returns a score, not a prompt instruction
// asking the model to self-penalize — cheaper (no extra tokens/calls) and
// reliable in a way "please score cautiously" isn't.
//
// aiContextSummary is deliberately NOT counted as "context" for a 'contact'
// candidate unless it actually carries content — mailchimp_notes (Mailchimp
// import metadata: exhibition-lead tags, MEMBER_RATING, even old
// ClientID/ClientPW pairs from Mailchimp's own fields) was considered as a
// backfill source and rejected after sampling real values — it's stale
// system metadata, not a writing preference, and would have taught the
// model the wrong thing rather than nothing at all.
const CONTEXT_PENALTY = 0.7 // multiplier, not a hard cutoff — a topic can still fit well enough to outweigh it

function hasWritingContext(candidate) {
  if (candidate.aiContextSummary?.trim()) return true
  if (candidate.emailSummary?.summary) return true
  if (candidate.whatsappSummary?.summary) return true
  if (candidate.alibabaSummary?.summary) return true
  // customers/ candidates carry real hand-typed CRM notes; contacts/ never
  // do (contactToEntity() always synthesizes a boilerplate "Company: X.
  // Country: Y" string here, which isn't genuine context — see its own
  // comment in DailyDrafts.jsx).
  if (candidate.source !== 'contact' && candidate.notes?.trim()) return true
  return false
}

function fitScorePrompt(topicLabel, candidate, historicalHints, targetingNote, memoryBlock) {
  return {
    system: 'You are a B2B sales analyst for Crystocraft, a premium Hong Kong corporate gift manufacturer. ' +
      'Given a customer profile and a topic the owner wants to reach out about, judge how likely that specific ' +
      'customer is to engage with an email on this topic. Return ONLY a valid JSON object: ' +
      '{ "fitScore": number between 0 and 1, "fitReason": "one short sentence" }.' +
      (targetingNote ? `\n\nToday's targeting focus, set by the owner — this is a STRONG requirement, not a preference: "${targetingNote}". A candidate that clearly does not fit this focus should score near 0, even if they would otherwise be a good match for the topic.` : '') +
      (historicalHints ? `\n\nKnown patterns from past outreach decisions (use as soft guidance, not a hard rule):\n${historicalHints}` : '') +
      (memoryBlock ? `\n\n${memoryBlock}` : ''),
    user: `Topic: ${topicLabel}\n\n` +
      `Customer: ${candidate.name}\nCountry: ${candidate.country || 'unknown'}\nRelationship type: ${candidate.crm_category || 'unknown'}\nStatus: ${candidate.crm_status || 'unknown'}\n` +
      `CRM notes: ${(candidate.notes || 'none').slice(0, 500)}` +
      (candidate.emailSummary?.summary
        ? `\nActual email history: ${candidate.emailSummary.summary.slice(0, 400)}` +
          (candidate.emailSummary.recent_activity ? ` Recent activity: ${candidate.emailSummary.recent_activity.slice(0, 300)}` : '')
        : '') +
      (candidate.whatsappSummary?.summary
        ? `\nActual WhatsApp history: ${candidate.whatsappSummary.summary.slice(0, 400)}` +
          (candidate.whatsappSummary.recent_activity ? ` Recent activity: ${candidate.whatsappSummary.recent_activity.slice(0, 300)}` : '')
        : '') +
      (candidate.alibabaSummary?.summary
        ? `\nActual Alibaba.com message history: ${candidate.alibabaSummary.summary.slice(0, 400)}` +
          (candidate.alibabaSummary.recent_activity ? ` Recent activity: ${candidate.alibabaSummary.recent_activity.slice(0, 300)}` : '')
        : ''),
  }
}

// The candidate step is now PERSONALIZATION of an owner-approved message,
// not drafting from scratch — the master subject/body already went through
// the Compose phase's own draft + refine loop (draft-outreach-topic.js,
// discuss-outreach-draft.js) before anyone was targeted.
function personalizePrompt(master, candidate, customerContext, memoryBlock) {
  const reminderNote = candidate.previouslyContactedAt
    ? `\n\nIMPORTANT: this person was already told about this on ${candidate.previouslyContactedAt} (per the CRM record) — the owner chose to include them again anyway. Write this as a polite REMINDER or follow-up with clear next steps, not a repeat of the original pitch.`
    : ''
  return {
    system: 'You are an expert B2B sales assistant for Crystocraft. The owner (Eddie) has already written and ' +
      'approved the message below — your job is to PERSONALIZE it for one specific recipient, not write a new one.\n\n' +
      'Requirements:\n' +
      '- Keep the core message/topic and plain-text style intact — adapt tone, add a specific reference to THIS ' +
      'customer\'s history if it genuinely fits, but do not change what the email is actually about.\n' +
      '- Use plain English; no HTML or markdown.\n' +
      '- Keep it under 4 sentences.\n' +
      '- Sound like a real person, not a marketing robot.\n' +
      '- Do NOT mention any other customer names.' +
      reminderNote +
      (memoryBlock ? `\n\n${memoryBlock}` : '') + '\n\n' +
      'Return ONLY a valid JSON object: { "subject": "string", "body": "string", "explanation": "one short sentence on what you personalized" }.',
    user: `Approved message:\nSubject: ${master.subject}\nBody: ${master.body}\n\n` +
      `Customer context:\n${customerContext}\n\nPersonalize this for ${candidate.name}.`,
  }
}

// Last 3 sales invoices for this customer's ERP code, via the same curated
// Supabase view erp.js already queries (erp_sales_invoice, searchable by
// customer_code). No self-call to /api/erp — this function already has the
// server creds, so it queries Supabase directly.
async function recentInvoices(supabaseUrl, serviceKey, erpCode) {
  if (!erpCode) return []
  const safe = erpCode.replace(/["\\]/g, ' ')
  const params = new URLSearchParams()
  params.set('select', 'code,customer,order_date,total')
  params.set('order', 'code.desc')
  params.set('limit', '3')
  params.set('customer_code', `ilike.*${safe}*`)
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/erp_sales_invoice?${params.toString()}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

function buildCustomerContext(candidate, invoices) {
  const parts = []
  if (candidate.crm_category || candidate.crm_status) {
    parts.push(`Relationship: ${candidate.crm_category || 'unknown'} (${candidate.crm_status || 'unknown'})`)
  }
  // Draft Memory Layer (V8.9) — the admin-edited relationship summary from
  // marketing_contacts/customers (ai_context_summary), listed first: it's
  // curated specifically for how to WRITE to this person, so it should
  // outrank raw CRM notes the same way real correspondence already does.
  if (candidate.aiContextSummary) parts.push(`Known writing preferences for this contact: ${candidate.aiContextSummary.slice(0, 800)}`)
  // Real correspondence outranks the hand-typed CRM notes field where the
  // two might disagree or the notes have gone stale — listed first for that
  // reason, not just because it's usually more specific.
  if (candidate.emailSummary?.summary) {
    parts.push(`Actual email history: ${candidate.emailSummary.summary.slice(0, 600)}`)
    if (candidate.emailSummary.recent_activity) {
      parts.push(`Most recent email activity: ${candidate.emailSummary.recent_activity.slice(0, 400)}`)
    }
    if (candidate.emailSummary.open_commitments?.length) {
      parts.push(`Open commitments from email: ${candidate.emailSummary.open_commitments.slice(0, 5).join('; ')}`)
    }
  }
  if (candidate.whatsappSummary?.summary) {
    parts.push(`Actual WhatsApp history: ${candidate.whatsappSummary.summary.slice(0, 600)}`)
    if (candidate.whatsappSummary.recent_activity) {
      parts.push(`Most recent WhatsApp activity: ${candidate.whatsappSummary.recent_activity.slice(0, 400)}`)
    }
    if (candidate.whatsappSummary.open_commitments?.length) {
      parts.push(`Open commitments from WhatsApp: ${candidate.whatsappSummary.open_commitments.slice(0, 5).join('; ')}`)
    }
  }
  if (candidate.alibabaSummary?.summary) {
    parts.push(`Actual Alibaba.com message history: ${candidate.alibabaSummary.summary.slice(0, 600)}`)
    if (candidate.alibabaSummary.recent_activity) {
      parts.push(`Most recent Alibaba.com activity: ${candidate.alibabaSummary.recent_activity.slice(0, 400)}`)
    }
    if (candidate.alibabaSummary.open_commitments?.length) {
      parts.push(`Open commitments from Alibaba.com: ${candidate.alibabaSummary.open_commitments.slice(0, 5).join('; ')}`)
    }
  }
  if (candidate.notes) parts.push(`CRM notes: ${candidate.notes.slice(0, 800)}`)
  if (invoices.length) {
    const lines = invoices.map(i => `- ${i.code} on ${i.order_date || '?'}: ${i.total ?? '?'}`).join('\n')
    parts.push(`Recent purchases:\n${lines}`)
  } else {
    parts.push('No purchase history on file.')
  }
  return parts.join('\n\n')
}

// Which context actually fed this draft — owner asked 2026-08-12 "how do I
// know if email/CRM notes were considered", and there was no way to tell
// short of reading the raw customerContext text. Small, explicit, so the
// review UI can just show it rather than the owner having to infer it.
function contextSources(candidate, invoices) {
  const sources = []
  if (candidate.emailSummary?.summary) sources.push('email')
  if (candidate.whatsappSummary?.summary) sources.push('whatsapp')
  if (candidate.alibabaSummary?.summary) sources.push('alibaba')
  if (candidate.notes) sources.push('notes')
  if (invoices.length) sources.push('invoices')
  if (candidate.aiContextSummary) sources.push('memory')
  return sources
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_KEY = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!DEEPSEEK_API_KEY || !SUPABASE_URL || !SUPABASE_KEY || !PROJECT_ID) {
    return json({ error: 'Server not configured' }, 500)
  }

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub
  } catch { return json({ error: 'Invalid or expired session' }, 401) }
  if (!(await isFrontOffice(uid, token, PROJECT_ID))) return json({ error: 'Access denied' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const master = body?.master
  const topicLabel = String(body?.topicLabel || '').slice(0, 200)
  const candidates = Array.isArray(body?.candidates) ? body.candidates.slice(0, MAX_CANDIDATES) : []
  const historicalHints = String(body?.historicalHints || '').slice(0, 1500)
  const targetingNote = String(body?.targetingNote || '').slice(0, 300)
  if (!master?.subject || !master?.body) return json({ error: 'An approved master subject/body is required' }, 400)
  if (!candidates.length) return json({ error: 'No candidates supplied' }, 400)

  // Draft Memory Layer (V8.9) — Eddie's confirmed global writing rules,
  // folded into both the fit-scoring and personalization prompts below. No
  // per-candidate contactSummary here — buildCustomerContext() already folds
  // each candidate's own aiContextSummary in directly (see lib/draftMemory.js
  // header on why this stays formatting-only, no Firestore reads).
  const globalRulesBlock = buildMemoryBlock({
    globalRules: Array.isArray(body?.memory?.globalRules) ? body.memory.globalRules.slice(0, 8) : [],
  })

  // 1) Fit-score every candidate, chunked to stay polite to DeepSeek's rate limit.
  const scored = []
  for (let i = 0; i < candidates.length; i += SCORE_CHUNK) {
    const chunk = candidates.slice(i, i + SCORE_CHUNK)
    const results = await Promise.all(chunk.map(async (c) => {
      const r = await callDeepSeek(DEEPSEEK_API_KEY, { ...fitScorePrompt(topicLabel || master.subject, c, historicalHints, targetingNote, globalRulesBlock), temperature: 0.3, maxTokens: 200 })
      const rawScore = typeof r?.fitScore === 'number' ? r.fitScore : 0
      const contexted = hasWritingContext(c)
      const fitScore = contexted ? rawScore : rawScore * CONTEXT_PENALTY
      const baseReason = r?.fitReason || ''
      const fitReason = contexted ? baseReason : `${baseReason}${baseReason ? ' — ' : ''}no interaction data on file, scored cautiously`
      return { candidate: c, fitScore, fitReason }
    }))
    scored.push(...results)
  }

  // 2) Keep the top N.
  const finalists = scored.sort((a, b) => b.fitScore - a.fitScore).slice(0, TOP_N)

  // 3) For each finalist: pull real purchase history, then personalize the approved message.
  const drafts = await Promise.all(finalists.map(async ({ candidate, fitScore, fitReason }) => {
    const invoices = await recentInvoices(SUPABASE_URL, SUPABASE_KEY, candidate.erp_code)
    const customerContext = buildCustomerContext(candidate, invoices)
    const draft = await callDeepSeek(DEEPSEEK_API_KEY, { ...personalizePrompt(master, candidate, customerContext, globalRulesBlock), temperature: 0.8, maxTokens: 400 })
    if (!draft?.subject || !draft?.body) return null
    return {
      customerId: candidate.id,
      customerEmail: candidate.email,
      customerName: candidate.name,
      customerContext,
      contextSources: contextSources(candidate, invoices),
      source: candidate.source || 'customer',
      fitScore,
      fitReason: fitReason || draft.explanation || '',
      draftSubject: draft.subject,
      draftBody: draft.body,
    }
  }))

  return json({ drafts: drafts.filter(Boolean) })
}

export const config = { path: '/api/generate-outreach-drafts' }
