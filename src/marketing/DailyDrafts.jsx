import { useEffect, useMemo, useState } from 'react'
import {
  collection, collectionGroup, doc, getDoc, getDocs, query, where,
  serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  Send, Loader2, SkipForward, Sparkles, Trash2, X, Link2, Upload,
  MessageCircle, CheckCircle2, Eye, MousePointerClick, AlertTriangle, Bookmark, BellOff, Mail, FileText, Receipt, Smartphone, UserPlus, Check,
  FlaskConical, ChevronDown, ChevronUp,
} from 'lucide-react'
import { db, storage, authedUser } from '../firebase'
import { loadCustomers, primaryContact, getCustomer, saveCustomer, CRM_CATEGORIES } from '../domain/customer'
import { normalizeContact, markContactOutreach, blockContactOutreach, promoteContactsToCustomers, linkContactToCustomer } from '../domain/marketingContact'
import {
  listPendingDrafts, listDraftsForTopic, listSentDrafts, listRecentDecisions,
  createDrafts, markDraftSent, markDraftReplied, skipDraft, deleteAllPending,
  appendMemoryConclusion,
} from '../domain/outreachDrafts'
import {
  listDraftMemoryRules, createDraftMemoryRule, approveDraftMemoryRule,
  rejectDraftMemoryRule, disableDraftMemoryRule, deleteDraftMemoryRule,
  updateDraftMemoryRuleText, MAX_ACTIVE_RULES,
} from '../domain/draftMemoryRules'
import { addInteraction } from '../domain/interactionLog'
import { generateDrafts, draftTopic, sendPersonalEmail, discussDraft } from '../outreachApi'
import { isPublicVisible } from '../constants'
import { loadBlogProducts, loadBlogImages } from '../productSource'
import { CustomerPicker } from '../pages/CustomerAccounts'

// Daily Drafts re-engagement engine — compose ANY topic (a product, "news
// and update", "invite to the portal"), refine it with AI until it's right,
// THEN target and personalize per recipient. See PROJECT-PLAN.md V7.23/V8.0
// and the plan this shipped from for the design reasoning throughout this
// file — in particular: two phases (Compose, then Target & Generate) so
// fixing the pitch happens once, not per-draft; AI fit-scoring instead of a
// hand-built category map; no persistent "recommended pick" flag; trade-
// audience-only marketing_contacts; why "reply tracking" is a manual toggle,
// not detection (Resend can't see inbound replies — see resend-webhook.js);
// and why topic-based candidate exclusion checks the CRM Interaction Log,
// not just this app's own send history (see checkAlreadyContacted below).

const COOLDOWN_DAYS = 14        // don't re-suggest someone within this many days of their last outreach
const TOPIC_COOLDOWN_DAYS = 21  // don't re-suggest the SAME topic to someone already sent it recently (via outreach_drafts)
const MAX_CANDIDATES = 60        // sent to fit-scoring; protects DeepSeek rate limits and function run time
const MAX_HISTORY_DECISIONS = 60 // how many recent sent/skipped drafts feed the historicalHints summary
const MAX_ATTACHED_IMAGES = 2

const daysAgo = (ts) => {
  if (!ts) return Infinity
  const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime()
  return (Date.now() - ms) / 86400000
}

// Direct upload (not from a product gallery) — Compose-phase images and the
// per-draft fallback when a draft has no linked product to pick from. Same
// idiom as Campaigns.jsx's Unlayer image callback (storageRef/uploadBytes/
// getDownloadURL), new path daily_draft_images/ (see storage.rules).
async function uploadImage(file) {
  const path = `daily_draft_images/${Date.now()}_${file.name}`
  const sRef = storageRef(storage, path)
  await uploadBytes(sRef, file)
  return await getDownloadURL(sRef)
}

// customers/{id} -> a common "entity" shape, or null if ineligible outright
// (no email). Kept separate from contactToEntity so each source's own
// eligibility rules stay readable, rather than one filter function branching
// on source internally.
//
// Deliberately NOT filtered by crm_status — the owner's call (2026-08):
// Active customers still belong in the pool (a few quiet months even on an
// active account is worth a nudge, especially once real email visibility
// lands — see the PST-archive idea, still deferred), and Inactive ones are
// worth trying too unless their email is actually dead. The real "don't
// suggest this person" signal is the owner's own knowledge of who they're
// already talking to manually — that's what the blockOutreachUntil action
// on each draft card is for, not a status guess.
function customerToEntity(c) {
  // email_bounced/email_complained (resend-webhook.js, on a hard bounce or
  // spam complaint reported against this customer's tagged send) is exactly
  // the "actually dead"/"stop emailing them" exception the comment above
  // describes — everything else about an inactive account still gets
  // suggested, a confirmed-dead address or a spam complaint doesn't.
  if (c.email_bounced || c.email_complained) return null
  const contact = primaryContact(c.contacts)
  const email = contact?.email?.trim().toLowerCase()
  if (!email) return null
  return {
    source: 'customer', id: c.id, name: c.company_name, email,
    // Retail Customer segment (2026-08-22) — lets the audience filter below
    // separate WooCommerce retail buyers from B2B customers. Most EXISTING
    // B2B customers have never had this set (null, not explicitly 'b2b') —
    // the filter treats "b2b" as "not retail," never "customer_type==='b2b'
    // exactly," so it doesn't suddenly exclude the entire pre-existing
    // customer base the day this field appeared.
    customer_type: c.customer_type || null,
    crm_category: c.crm_category, crm_status: c.crm_status,
    notes: c.notes, erp_code: c.erp_code, country: c.country,
    // Draft Memory Layer (V8.9) — extended from marketing_contacts to
    // customers too (see domain/customer.js's updateCustomerAiSummary),
    // same field folded into buildCustomerContext() server-side.
    aiContextSummary: c.ai_context_summary || '',
    lastOutreachAt: c.lastOutreachAt, blockOutreachUntil: c.blockOutreachUntil,
    // Draft Daily WhatsApp channel support (2026-08-19) — snapshotted at
    // draft-creation time, same posture as name/email above (not a live
    // join). whatsapp is the older, unclassified single number (Case 5:
    // shown as a neutral "WhatsApp" action, never relabeled); personal/
    // business are separate opt-in fields the admin fills in only when
    // actually known (CustomerForm.jsx's ContactsEditor).
    whatsapp: contact?.whatsapp || '',
    whatsapp_personal: contact?.whatsapp_personal || '',
    whatsapp_business: contact?.whatsapp_business || '',
    // V8.1 email ingestion — a DeepSeek read of this customer's actual email
    // history (see refresh-email-summary.js), only present once an admin's
    // generated one from CustomerDetail.jsx. Only summary/recent_activity/
    // open_commitments travel to the edge function — generated_at is a
    // Firestore Timestamp, not JSON-serializable, and thread_count isn't
    // needed for a prompt.
    emailSummary: c.email_summary
      ? { summary: c.email_summary.summary, recent_activity: c.email_summary.recent_activity, open_commitments: c.email_summary.open_commitments }
      : null,
    // V8.2 WhatsApp ingestion — same shape/posture as emailSummary above,
    // generated on-demand from CustomerDetail.jsx's WhatsApp card (see
    // refresh-whatsapp-summary.js). Only present once an admin's generated
    // one. contactToEntity() below has its own equivalent as of V8.9 — see
    // its comment for why email ingestion still doesn't (that pipeline's
    // matching logic is customers-only, a bigger change than WhatsApp's).
    whatsappSummary: c.whatsapp_summary
      ? { summary: c.whatsapp_summary.summary, recent_activity: c.whatsapp_summary.recent_activity, open_commitments: c.whatsapp_summary.open_commitments }
      : null,
  }
}

// marketing_contacts/{id} -> the same common shape. Trade-audience only (a
// personal "Hi, I'm Eddie" note is a strange fit for a retail/e-com buyer —
// agreed with the owner), subscribed+emailable (same suppression check
// domain/campaigns.js's eligibleContacts uses), and never a contact already
// linked to a customer record (possible_customer_match) — that person is
// already representable via their customer entity above, with real cooldown
// tracking; including them again here would double-message the same real
// inbox from two records with no shared suppression state.
function contactToEntity(c) {
  if (c.status !== 'subscribed' || !c.emailable) return null
  if (!c.audiences.includes('trade')) return null
  if (c.possible_customer_match) return null
  const email = c.email?.trim().toLowerCase()
  if (!email) return null
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || email
  const notes = [
    c.company && `Company: ${c.company}`,
    c.country && `Country: ${c.country}`,
    c.tags.length && `Tags: ${c.tags.join(', ')}`,
  ].filter(Boolean).join('. ')
  return {
    source: 'contact', id: c.id, name, email,
    crm_category: 'Marketing contact (trade lead, not yet a customer)', crm_status: 'Prospect',
    notes, erp_code: '', country: c.country,
    // Draft Memory Layer (V8.9) — admin-edited relationship summary (see
    // MarketingContacts.jsx's EditContactModal), folded into
    // buildCustomerContext() server-side so the AI actually knows what's
    // already been confirmed about this contact instead of guessing fresh
    // every generate. customers/ has no equivalent field yet — Phase 1 is
    // scoped to marketing_contacts, per the original ask.
    aiContextSummary: c.ai_context_summary || '',
    // V8.9 — WhatsApp summaries now reach marketing_contacts too (see
    // MarketingContacts.jsx's WhatsAppThreads "Generate/Refresh" and
    // whatsappSummaryApi.js's generateAndSaveWhatsappSummary), same shape as
    // customerToEntity's own whatsappSummary above. Only present once an
    // admin's actually generated one for this contact.
    whatsappSummary: c.whatsapp_summary
      ? { summary: c.whatsapp_summary.summary, recent_activity: c.whatsapp_summary.recent_activity, open_commitments: c.whatsapp_summary.open_commitments }
      : null,
    lastOutreachAt: c.lastOutreachAt, blockOutreachUntil: c.blockOutreachUntil,
    // marketing_contacts has only one scalar phone field (no personal/
    // business split — see domain/marketingContact.js) — a phone-sourced
    // lead (findOrCreateLeadByPhone) IS a WhatsApp number, but with no
    // account classification, so it's neutral/unclassified here too.
    whatsapp: c.phone || '',
    whatsapp_personal: '',
    whatsapp_business: '',
  }
}

// Shared filter/dedupe/sort over the merged customer+contact entity pool.
// Excludes and dedupes by EMAIL, not just id — this CRM has known duplicate
// customer records for the same company, and a contact can independently
// share an email with a not-yet-linked customer record; either way the same
// real inbox must only get one draft. Customers are processed first (richer
// context — CRM notes, ERP history), so a same-email overlap with an
// unlinked contact resolves in the customer's favor.
function eligibleCandidates(entities, excludedIds, excludedEmails) {
  const now = Date.now()
  const seenEmails = new Set()
  const pool = entities.filter(e => {
    if (!e) return false
    if (e.blockOutreachUntil) {
      const until = e.blockOutreachUntil.toMillis ? e.blockOutreachUntil.toMillis() : new Date(e.blockOutreachUntil).getTime()
      if (until > now) return false
    }
    if (daysAgo(e.lastOutreachAt) < COOLDOWN_DAYS) return false
    if (excludedIds.has(e.id) || excludedEmails.has(e.email)) return false
    if (seenEmails.has(e.email)) return false
    seenEmails.add(e.email)
    return true
  })
  // never-contacted (Infinity) sorts first — but Array.sort is stable, and
  // customers are concatenated before contacts (see caller), so a plain
  // recency sort left every tie (very common: 108 never-contacted customers
  // alone, already over MAX_CANDIDATES) in source order. With more
  // never-contacted customers than MAX_CANDIDATES, marketing_contacts could
  // mathematically never reach the slice below regardless of how many were
  // eligible — confirmed live 2026-08-12, the owner had never once seen a
  // contact-sourced draft. Random tiebreaker so ties don't systematically
  // favor whichever source happened to be concatenated first.
  pool.sort((a, b) => daysAgo(b.lastOutreachAt) - daysAgo(a.lastOutreachAt) || Math.random() - 0.5)
  return pool.slice(0, MAX_CANDIDATES).map(e => ({
    id: e.id, name: e.name, email: e.email, source: e.source,
    crm_category: e.crm_category, crm_status: e.crm_status, notes: e.notes, erp_code: e.erp_code,
    country: e.country, emailSummary: e.emailSummary || null,
    // Carried through so handleGenerate's post-generation re-attach step
    // (joins the AI's response back to `candidates` by id) has real values
    // to read. Without these three, that join always re-attached `undefined`
    // — found 2026-08-22: the WhatsApp quick-access chips in the review card
    // never appeared for ANY draft, customer or lead, because this trimmed
    // object was the only copy of the candidate the re-attach step could see,
    // and it never carried whatsapp data in the first place.
    whatsapp: e.whatsapp, whatsapp_personal: e.whatsapp_personal, whatsapp_business: e.whatsapp_business,
  }))
}

// A short plain-text summary of recent sent/skipped decisions, folded into
// the fit-score prompt (generate-outreach-drafts.js) as soft guidance. This
// is prompt-engineering, not fine-tuning — DeepSeek has no memory or
// training hook here; each run is still stateless, it's just told what
// happened recently.
function summarizeHistory(decisions) {
  if (!decisions.length) return ''
  const sent = decisions.filter(d => d.status === 'sent').length
  const skipped = decisions.filter(d => d.status === 'skipped')
  const reasonCounts = new Map()
  for (const d of skipped) {
    const r = (d.skipReason || '').trim()
    if (!r) continue
    reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1)
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const parts = [`Of the last ${decisions.length} reviewed drafts: ${sent} were sent, ${skipped.length} were skipped.`]
  if (topReasons.length) {
    parts.push('Common skip reasons: ' + topReasons.map(([r, n]) => `"${r}" (${n}x)`).join(', ') + '.')
  }
  return parts.join(' ')
}

// Always shown (not just for contacts) so it's obvious at a glance which
// pool a draft came from — customers/ (real account, richer context) vs
// marketing_contacts/ (a trade lead, thinner context — see contactToEntity).
function SourceBadge({ source }) {
  const isContact = source === 'contact'
  return (
    <span className={`ml-1.5 text-[10px] uppercase tracking-wide rounded px-1 py-0.5 shrink-0 ${
      isContact ? 'text-amber-600 bg-amber-50' : 'text-blue-600 bg-blue-50'
    }`}>
      {isContact ? 'Lead' : 'Customer'}
    </span>
  )
}

// Writes one entry to the CRM Interaction Log (domain/interactionLog.js —
// customers/{id}/enquiries, or as of V8.9 marketing_contacts/{id}/enquiries
// too, same shape either way). This used to be customers-only, inlined here
// (marketing_contacts logged to app_notes instead — a flat string, not a
// structured log). The owner asked directly for auto-logged interactions on
// contacts as well, so every call site below now logs to whichever
// collection the draft's source actually is.
//
// `productInterest` tags what this was ABOUT (a topic label or product
// name) — it's what checkAlreadyContacted() below queries on, so every
// send/reply MUST carry it or de-duplication silently stops working for
// future runs. Same requirement now applies to contact-sourced drafts too,
// which is also what makes them visible to that check for the first time.
function logInteraction(source, id, { description, channel, productInterest }) {
  return addInteraction(source === 'contact' ? 'marketing_contacts' : 'customers', id, { description, channel, productInterest })
}

async function appendNote(collectionName, id, field, text) {
  const snap = await getDoc(doc(db, collectionName, id))
  const existing = snap.exists() ? (snap.data()[field] || '') : ''
  await updateDoc(doc(db, collectionName, id), {
    [field]: [existing, text].filter(Boolean).join('\n'), updatedAt: serverTimestamp(),
  })
}

// "Don't keep re-inviting someone I already told" — checks the CRM
// Interaction Log (the actual complete history: manually logged entries,
// entries from before this feature existed, everything — not just what this
// app itself has sent) for a prior entry about this exact topicLabel, across
// EVERY customer AND marketing_contacts lead at once via a single
// collection-group query — as of V8.9, marketing_contacts/{id}/enquiries is
// the same subcollection name, so this needed no code change to start
// covering contacts too (it previously only ever matched customers/, since
// contacts had nowhere to log an entry at all). Requires firestore.rules'
// top-level `enquiries` wildcard rule AND the collection-group field index
// enabled in the Firebase console — if either isn't set up yet this throws,
// so the caller treats a failure as "couldn't check, proceeding without
// this filter" rather than crashing the whole generate.
// Returns Map<id, dateString> (most recent contact date per person, customer or contact id alike).
async function checkAlreadyContacted(topicLabel) {
  const snap = await getDocs(query(collectionGroup(db, 'enquiries'), where('product_interest', 'array-contains', topicLabel)))
  const map = new Map()
  snap.forEach(docSnap => {
    const customerId = docSnap.ref.parent.parent?.id
    if (!customerId) return
    const data = docSnap.data()
    const ts = data.date?.toMillis?.() ?? 0
    const prev = map.get(customerId)
    if (!prev || ts > prev.ts) {
      map.set(customerId, { ts, dateStr: data.date?.toDate?.().toLocaleDateString() || 'previously' })
    }
  })
  return map
}

// Matches CustomerDetail.jsx's Compose Message channel list (which already
// distinguishes WhatsApp Business from Personal WhatsApp) plus WeChat, which
// exists nowhere in this app's channel enums yet despite being a real
// channel the owner uses.
const REPLY_CHANNELS = ['Personal WhatsApp', 'WhatsApp Business', 'WeChat', 'Alibaba', 'Email']

const ENGAGEMENT_BADGES = [
  { key: 'delivered', label: 'Delivered', Icon: CheckCircle2 },
  { key: 'opened', label: 'Opened', Icon: Eye },
  { key: 'clicked', label: 'Clicked', Icon: MousePointerClick },
  { key: 'bounced', label: 'Bounced', Icon: AlertTriangle },
  // 'complained' was written by resend-webhook.js from day one but never
  // rendered anywhere in the app — a spam complaint silenced/flagged the
  // record server-side with no visible trail (found during the SU-08
  // interaction-log audit, 2026-08-18).
  { key: 'complained', label: 'Complained', Icon: AlertTriangle },
]

export default function DailyDrafts() {
  // ── Compose phase ──────────────────────────────────────────────────────
  const [topic, setTopic] = useState('')
  const [masterSubject, setMasterSubject] = useState('')
  const [masterBody, setMasterBody] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [masterImageUrls, setMasterImageUrls] = useState([])
  const [masterUploading, setMasterUploading] = useState(false)
  const [masterLinks, setMasterLinks] = useState([]) // [{ title, url }, ...] — pasted in manually
  const [masterLinkFormOpen, setMasterLinkFormOpen] = useState(false)
  const [masterLinkUrl, setMasterLinkUrl] = useState('')
  const [masterLinkTitle, setMasterLinkTitle] = useState('')

  // Refine-with-AI chat on the MASTER message — same discuss-outreach-draft.js
  // endpoint the per-draft chat uses, called with customerContext: '' since
  // no candidate is chosen yet at this stage.
  const [masterChatOpen, setMasterChatOpen] = useState(false)
  const [masterChatHistory, setMasterChatHistory] = useState([])
  const [masterChatInput, setMasterChatInput] = useState('')
  const [masterChatBusy, setMasterChatBusy] = useState(false)

  // Optional: link a product just to unlock its photo gallery. NOT required
  // to compose a topic — most topics (news/update, portal invite) have no
  // product at all.
  const [products, setProducts] = useState([]) // merged corporate + Crystocraft Range, each tagged .source
  const [linkedProduct, setLinkedProduct] = useState(null)
  const [linkProductOpen, setLinkProductOpen] = useState(false)
  const [linkProductQuery, setLinkProductQuery] = useState('')
  const [linkedProductImages, setLinkedProductImages] = useState([])

  // ── Target & Generate phase ────────────────────────────────────────────
  const [targetingNote, setTargetingNote] = useState('')
  // Retail Customer segment (2026-08-22) — a hard pre-filter on the
  // candidate pool, not just a hint in targetingNote (which the AI can
  // ignore/misread). Defaults to 'b2b': Daily Drafts has always been a
  // trade-outreach tool, and the bulk WooCommerce sync just added a lot of
  // retail customers that would otherwise silently flood the candidate pool
  // for a personal "Hi, I'm Eddie" style note that doesn't fit them at all.
  const [audienceFilter, setAudienceFilter] = useState('b2b') // 'b2b' | 'retail' | 'all'
  const [categoryFilter, setCategoryFilter] = useState([]) // crm_category[] — empty = all, only meaningful for 'b2b'
  const [includeAlreadyContacted, setIncludeAlreadyContacted] = useState(false)
  const [generating, setGenerating] = useState(false)

  // ── Review (Pending / Sent) ─────────────────────────────────────────────
  const [drafts, setDrafts] = useState([])
  const [sentDrafts, setSentDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [edits, setEdits] = useState({}) // draftId -> { subject, body, imageUrls, links }
  // draftId of the test send that just completed — a brief inline confirmation
  // ("Sent to you@..."), not persisted anywhere (a test send is deliberately
  // invisible to Firestore/engagement tracking, see handleSendTest below).
  const [testSentId, setTestSentId] = useState(null)

  // Per-draft "discuss with AI" chat — working scratch, not persisted to
  // Firestore (see discuss-outreach-draft.js's header comment).
  const [chatOpenId, setChatOpenId] = useState(null)
  const [chatHistory, setChatHistory] = useState({}) // draftId -> [{role, content}]
  const [chatInput, setChatInput] = useState({}) // draftId -> string
  const [chatBusy, setChatBusy] = useState(null)

  // Bulk rewrite — owner's own request (2026-08-13): the same correction
  // ("wrong sign-off", "too long", "wrong angle") often applies to several
  // drafts at once, and doing it one chat at a time is slow. Reuses the
  // SAME discuss-outreach-draft.js call the per-draft chat uses (one call
  // per draft, sequentially — a real DeepSeek round trip each time, and
  // avoids racing rate limits the same way the WhatsApp bulk-summary scan
  // does), just fired once per pending draft with no prior history. Never
  // touches sent/skipped drafts — only whatever's still in `drafts`.
  const [bulkRewriteOpen, setBulkRewriteOpen] = useState(false)
  const [bulkRewriteInput, setBulkRewriteInput] = useState('')
  const [bulkRewriteBusy, setBulkRewriteBusy] = useState(false)
  const [bulkRewriteProgress, setBulkRewriteProgress] = useState(null) // { done, total }
  const [bulkRewriteError, setBulkRewriteError] = useState('')

  // Add a lead to Customers — owner's own request (2026-08-13): reviewing a
  // 'contact' (Lead) draft is often the moment worth acting on ("this is a
  // real prospect, get them into the CRM properly") rather than waiting to
  // do it separately from Marketing Contacts later. Two paths: promote the
  // lead into a brand-new customers/ record (reuses promoteContactsToCustomers,
  // same as Marketing Contacts' own bulk-promote action), or append them as
  // an extra contact on an EXISTING customer (e.g. a second person at a
  // company already in the CRM) — a plain customers/{id}.contacts[] write,
  // same shape ContactsEditor (CustomerForm.jsx) produces. Either way,
  // linkContactToCustomer marks the lead as matched, so it naturally drops
  // out of future Daily Drafts batches (contactToEntity already excludes
  // any contact with possible_customer_match set — see its own comment).
  const [addCustomerOpenId, setAddCustomerOpenId] = useState(null)
  const [addCustomerMode, setAddCustomerMode] = useState('new') // 'new' | 'existing'
  const [addCustomerPickId, setAddCustomerPickId] = useState('')
  const [addCustomerBusy, setAddCustomerBusy] = useState(false)
  const [addCustomerError, setAddCustomerError] = useState('')
  const [addCustomerDone, setAddCustomerDone] = useState({}) // draftId -> confirmation message
  // Draft Daily WhatsApp channel support (2026-08-19) — opening a wa.me link
  // is a manual action, never auto-logged; whatsappOpened just reveals the
  // "Log WhatsApp outreach" button once Eddie has actually clicked one, and
  // whatsappLogged prevents a repeat click from writing a duplicate
  // interaction (mirrors addCustomerDone's confirmation-state pattern).
  const [whatsappOpened, setWhatsappOpened] = useState({}) // draftId -> last channel opened ('personal'|'business'|'unknown')
  const [whatsappLogged, setWhatsappLogged] = useState({}) // draftId -> true once logged
  const [pickerCustomers, setPickerCustomers] = useState([])
  useEffect(() => { loadCustomers().then(setPickerCustomers) }, [])

  // Draft Memory Layer (V8.9) — global writing rules, loaded once (small,
  // admin-curated list) and re-fetched after any approve/disable/delete so
  // the panel and the next prompt call both see the current state. Only
  // 'active' rules are ever sent to a prompt — see activeRuleTexts below.
  const [memoryRules, setMemoryRules] = useState([])
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false)
  const [memoryRuleBusy, setMemoryRuleBusy] = useState(null)
  const [newRuleText, setNewRuleText] = useState('')
  const [editingRuleId, setEditingRuleId] = useState(null)
  const [editingRuleText, setEditingRuleText] = useState('')
  function reloadMemoryRules() {
    listDraftMemoryRules().then(setMemoryRules).catch(() => {}) // never blocks the page
  }
  useEffect(() => { reloadMemoryRules() }, [])
  const activeRuleTexts = useMemo(() => memoryRules.filter(r => r.status === 'active').map(r => r.text), [memoryRules])
  const pendingRules = useMemo(() => memoryRules.filter(r => r.status === 'pending'), [memoryRules])
  const activeRules = useMemo(() => memoryRules.filter(r => r.status === 'active'), [memoryRules])

  // "Remember this rule" — the ONLY way a rule enters draft_memory_rules
  // (see domain/draftMemoryRules.js). Always lands as 'pending': it does not
  // steer any draft until approved in the review panel below, even though
  // Eddie already confirmed it here — a second, deliberate step before
  // something reshapes every future draft.
  async function handleRememberRule(text) {
    const clean = text.trim()
    if (!clean) return
    try {
      const user = await authedUser()
      await createDraftMemoryRule({ text: clean, source: 'confirmed', createdBy: user?.uid })
      reloadMemoryRules()
      setMemoryPanelOpen(true)
    } catch (e) {
      setError(e.message || 'Could not save that rule.')
    }
  }

  async function handleApproveRule(id) {
    setMemoryRuleBusy(id)
    try {
      const user = await authedUser()
      await approveDraftMemoryRule(id, user?.uid)
      reloadMemoryRules()
    } catch (e) {
      setError(e.message || 'Could not approve that rule.')
    } finally {
      setMemoryRuleBusy(null)
    }
  }
  async function handleRejectRule(id) {
    setMemoryRuleBusy(id)
    try {
      const user = await authedUser()
      await rejectDraftMemoryRule(id, user?.uid)
      reloadMemoryRules()
    } finally {
      setMemoryRuleBusy(null)
    }
  }
  async function handleDisableRule(id) {
    setMemoryRuleBusy(id)
    try { await disableDraftMemoryRule(id); reloadMemoryRules() }
    finally { setMemoryRuleBusy(null) }
  }
  async function handleDeleteRule(id) {
    if (!window.confirm('Delete this rule permanently?')) return
    setMemoryRuleBusy(id)
    try { await deleteDraftMemoryRule(id); reloadMemoryRules() }
    finally { setMemoryRuleBusy(null) }
  }
  async function handleSaveRuleEdit(id) {
    try {
      await updateDraftMemoryRuleText(id, editingRuleText)
      setEditingRuleId(null)
      reloadMemoryRules()
    } catch (e) {
      setError(e.message || 'Could not save that edit.')
    }
  }
  async function handleAddRuleDirect() {
    const clean = newRuleText.trim()
    if (!clean) return
    try {
      const user = await authedUser()
      await createDraftMemoryRule({ text: clean, source: 'admin', createdBy: user?.uid })
      setNewRuleText('')
      reloadMemoryRules()
    } catch (e) {
      setError(e.message || 'Could not save that rule.')
    }
  }

  function openAddCustomer(d) {
    setAddCustomerOpenId(addCustomerOpenId === d.id ? null : d.id)
    setAddCustomerMode('new'); setAddCustomerPickId(''); setAddCustomerError('')
  }

  async function handleCreateNewCustomer(d) {
    setAddCustomerBusy(true); setAddCustomerError('')
    try {
      const snap = await getDoc(doc(db, 'marketing_contacts', d.customerId))
      if (!snap.exists()) throw new Error('This lead record no longer exists.')
      const lead = normalizeContact(snap.id, snap.data())
      if (lead.possible_customer_match) throw new Error('This lead is already linked to a customer.')
      const { created, skipped } = await promoteContactsToCustomers([lead])
      if (skipped.length || !created.length) throw new Error('Could not create a customer for this lead.')
      const msg = `Added as a new customer: ${created[0].companyName}` +
        (created[0].historyWarning ? ' (notes/WhatsApp history may not have fully carried over — check the Interaction Log)' : '')
      setAddCustomerDone(prev => ({ ...prev, [d.id]: msg }))
      setAddCustomerOpenId(null)
      setPickerCustomers(await loadCustomers())
    } catch (e) {
      setAddCustomerError(e.message || 'Could not create the customer.')
    } finally {
      setAddCustomerBusy(false)
    }
  }

  async function handleAddAsContact(d) {
    if (!addCustomerPickId) { setAddCustomerError('Pick a customer first.'); return }
    setAddCustomerBusy(true); setAddCustomerError('')
    try {
      const leadSnap = await getDoc(doc(db, 'marketing_contacts', d.customerId))
      if (!leadSnap.exists()) throw new Error('This lead record no longer exists.')
      const lead = normalizeContact(leadSnap.id, leadSnap.data())
      if (lead.possible_customer_match) throw new Error('This lead is already linked to a customer.')
      const customer = await getCustomer(addCustomerPickId)
      if (!customer) throw new Error('That customer no longer exists.')
      const newContact = {
        name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.company || lead.email,
        email: lead.email,
        phone: lead.phone,
        is_primary: false,
      }
      const res = await saveCustomer(addCustomerPickId, { ...customer, contacts: [...customer.contacts, newContact] })
      if (!res.ok) throw new Error(res.result.errors?.[0]?.message || 'Could not save that contact.')
      const { historyWarning } = await linkContactToCustomer(d.customerId, addCustomerPickId, customer.company_name)
      const msg = `Added as a contact on ${customer.company_name}` +
        (historyWarning ? ' (notes/WhatsApp history may not have fully carried over — check the Interaction Log)' : '')
      setAddCustomerDone(prev => ({ ...prev, [d.id]: msg }))
      setAddCustomerOpenId(null)
    } catch (e) {
      setAddCustomerError(e.message || 'Could not add this contact.')
    } finally {
      setAddCustomerBusy(false)
    }
  }

  // Per-draft attachment editing — separate from the compose-phase default.
  // Each draft's photos/links can be added to or removed from independently.
  const [productImagesCache, setProductImagesCache] = useState({}) // "source:productId" -> images[]
  const [photoPickerOpenId, setPhotoPickerOpenId] = useState(null)
  const [linkFormOpenId, setLinkFormOpenId] = useState(null)
  const [draftLinkUrl, setDraftLinkUrl] = useState({}) // draftId -> string
  const [draftLinkTitle, setDraftLinkTitle] = useState({}) // draftId -> string
  const [draftUploading, setDraftUploading] = useState(null)

  // "Log a reply" mini-form on Sent cards — channel + optionally the pasted
  // reply text, since replies mostly land on WhatsApp/WeChat/Alibaba, not
  // this app's inbox (see handleLogReply).
  const [replyFormOpenId, setReplyFormOpenId] = useState(null)
  const [replyChannel, setReplyChannel] = useState({}) // draftId -> string
  const [replyText, setReplyText] = useState({}) // draftId -> string

  // Both catalogues, merged — Corporate Gifts (`products`) and the
  // Crystocraft Range (`range_products`) are separate collections with very
  // different shapes; productSource.js's loadBlogProducts() already
  // normalizes either into one common shape (id, source, name, category,
  // description, images/heroImage). Same adapter FrontPageProductPicker.jsx
  // and the Blog Writer use for the same "search both catalogues" need.
  useEffect(() => {
    Promise.all([loadBlogProducts('corporate'), loadBlogProducts('range')]).then(([corp, range]) => {
      setProducts([...corp, ...range])
    })
    reload()
    reloadSent()
  }, [])

  // Linked product's own image gallery, filtered to visibility:'public'.
  useEffect(() => {
    if (!linkedProduct) { setLinkedProductImages([]); return }
    loadBlogImages(linkedProduct.source, linkedProduct).then(imgs => {
      setLinkedProductImages(imgs.filter(isPublicVisible))
    })
  }, [linkedProduct])

  const filteredLinkProducts = useMemo(() => {
    const q = linkProductQuery.trim().toLowerCase()
    if (!q) return products.slice(0, 50)
    return products.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 50)
  }, [products, linkProductQuery])

  function toggleMasterImage(url) {
    setMasterImageUrls(prev =>
      prev.includes(url) ? prev.filter(u => u !== url) : prev.length < MAX_ATTACHED_IMAGES ? [...prev, url] : prev
    )
  }

  async function handleMasterUpload(file) {
    if (!file || masterImageUrls.length >= MAX_ATTACHED_IMAGES) return
    setMasterUploading(true); setError('')
    try {
      const url = await uploadImage(file)
      setMasterImageUrls(prev => [...prev, url])
    } catch (e) {
      setError(e.message || 'Upload failed.')
    } finally {
      setMasterUploading(false)
    }
  }

  async function handleDraftTopic() {
    if (!topic.trim()) return
    setDrafting(true); setError('')
    try {
      const result = await draftTopic(topic.trim(), { globalRules: activeRuleTexts })
      setMasterSubject(result.subject)
      setMasterBody(result.body)
      setMasterChatHistory([])
    } catch (e) {
      setError(e.message || 'Could not draft a starting message.')
    } finally {
      setDrafting(false)
    }
  }

  async function handleMasterChatSend() {
    const message = masterChatInput.trim()
    if (!message) return
    setMasterChatBusy(true); setError('')
    try {
      const result = await discussDraft({
        productContext: topic.trim() || linkedProduct?.name || '',
        customerContext: '',
        draftSubject: masterSubject,
        draftBody: masterBody,
        history: masterChatHistory,
        message,
        memory: { globalRules: activeRuleTexts },
      })
      setMasterChatHistory(prev => [...prev, { role: 'user', content: message }, { role: 'assistant', content: result.reply }])
      setMasterChatInput('')
      if (result.subject) setMasterSubject(result.subject)
      if (result.body) setMasterBody(result.body)
    } catch (e) {
      setError(e.message || 'Chat failed.')
    } finally {
      setMasterChatBusy(false)
    }
  }

  function applyMasterLink() {
    const url = masterLinkUrl.trim()
    if (!url) return
    setMasterLinks(prev => [...prev, { title: masterLinkTitle.trim() || url, url }])
    setMasterLinkUrl(''); setMasterLinkTitle(''); setMasterLinkFormOpen(false)
  }
  function removeMasterLink(url) {
    setMasterLinks(prev => prev.filter(l => l.url !== url))
  }

  function reload() {
    setLoading(true)
    listPendingDrafts()
      .then(setDrafts)
      .catch(e => setError(e.message || 'Could not load pending drafts.'))
      .finally(() => setLoading(false))
  }

  function reloadSent() {
    listSentDrafts().then(setSentDrafts).catch(() => {}) // engagement/sent history is a nicety — never blocks the page
  }

  function resetCompose() {
    setTopic(''); setMasterSubject(''); setMasterBody(''); setMasterChatHistory([]); setMasterChatOpen(false)
    setMasterImageUrls([]); setMasterLinks([]); setMasterLinkFormOpen(false); setMasterLinkUrl(''); setMasterLinkTitle('')
    setLinkedProduct(null); setLinkProductQuery(''); setLinkProductOpen(false)
    setTargetingNote(''); setIncludeAlreadyContacted(false)
  }

  async function handleGenerate() {
    if (!masterSubject.trim() || !masterBody.trim()) { setError('Draft and approve a message first.'); return }
    const topicLabel = (topic.trim() || linkedProduct?.name || masterSubject).slice(0, 200)
    setGenerating(true); setError('')
    try {
      const [customers, contactDocs, existingDrafts, recentDecisions] = await Promise.all([
        loadCustomers(),
        getDocs(collection(db, 'marketing_contacts')),
        listDraftsForTopic(topicLabel),
        listRecentDecisions(MAX_HISTORY_DECISIONS),
      ])
      const contacts = contactDocs.docs.map(d => normalizeContact(d.id, d.data()))

      // Exclude anyone already sitting in pending_review for this topic
      // outright (regenerating must never duplicate an unreviewed draft), and
      // anyone sent this topic within the cooldown window. Excluded by both
      // id and email — see eligibleCandidates' comment on duplicate records.
      const alreadyDrafted = existingDrafts.filter(d =>
        d.status === 'pending_review' || (d.status === 'sent' && daysAgo(d.sentAt) < TOPIC_COOLDOWN_DAYS)
      )
      const excludedIds = new Set(alreadyDrafted.map(d => d.customerId))
      const excludedEmails = new Set(alreadyDrafted.map(d => (d.customerEmail || '').trim().toLowerCase()).filter(Boolean))

      // CRM Interaction Log check — the REAL complete history, not just what
      // this app has sent. Best-effort: a missing collection-group index/
      // rule shouldn't crash the whole generate, just skip this extra filter.
      let alreadyContactedMap = new Map()
      try {
        alreadyContactedMap = await checkAlreadyContacted(topicLabel)
      } catch (e) {
        setError(`Could not check prior contact history (${e.message || 'index may still be enabling'}) — proceeding without that filter this time.`)
      }
      if (!includeAlreadyContacted) {
        for (const customerId of alreadyContactedMap.keys()) excludedIds.add(customerId)
      }

      // Audience filter (2026-08-22) — a hard pre-filter, applied before
      // eligibility/cooldown checks so it can never be second-guessed by the
      // AI. contactToEntity() only ever returns 'trade' marketing_contacts
      // leads (retail leads are already excluded upstream) — there is no
      // such thing as a "retail contact" in this pool, so the retail
      // audience is customer-sourced only.
      let customerEntities = customers.map(customerToEntity)
      if (audienceFilter === 'retail') {
        customerEntities = customerEntities.filter(e => e && e.customer_type === 'retail')
      } else if (audienceFilter === 'b2b') {
        customerEntities = customerEntities.filter(e => e && e.customer_type !== 'retail')
        if (categoryFilter.length) customerEntities = customerEntities.filter(e => categoryFilter.includes(e.crm_category))
      }
      const entities = audienceFilter === 'retail'
        ? customerEntities
        : [...customerEntities, ...contacts.map(contactToEntity)]
      let candidates = eligibleCandidates(entities, excludedIds, excludedEmails)
      if (includeAlreadyContacted) {
        candidates = candidates.map(c => {
          const prior = alreadyContactedMap.get(c.id)
          return prior ? { ...c, previouslyContactedAt: prior.dateStr } : c
        })
      }
      if (!candidates.length) { setError('No eligible customers/contacts right now (cooldowns/blocks cleared the whole pool).'); return }

      const historicalHints = summarizeHistory(recentDecisions)
      const generated = await generateDrafts(
        { subject: masterSubject, body: masterBody },
        topicLabel,
        candidates,
        historicalHints,
        targetingNote.trim(),
        { globalRules: activeRuleTexts },
      )
      if (!generated.length) { setError('DeepSeek returned no usable drafts — try again.'); return }
      // generateDrafts is a server round-trip (generate-outreach-drafts.js) —
      // it only echoes back what the AI needed, not every field `candidates`
      // carried. Re-attach whatsapp/whatsapp_personal/whatsapp_business from
      // the original candidate by id so createDrafts can snapshot them.
      const candidatesById = new Map(candidates.map(c => [c.id, c]))
      const withWhatsapp = generated.map(d => {
        const cand = candidatesById.get(d.customerId)
        return cand ? { ...d, whatsapp: cand.whatsapp, whatsapp_personal: cand.whatsapp_personal, whatsapp_business: cand.whatsapp_business } : d
      })
      await createDrafts(
        { topicLabel, productId: linkedProduct?.id || null, productName: linkedProduct?.name || null, productSource: linkedProduct?.source || null },
        withWhatsapp,
        { imageUrls: masterImageUrls, links: masterLinks },
      )
      resetCompose()
      reload()
    } catch (e) {
      setError(e.message || 'Could not generate drafts.')
    } finally {
      setGenerating(false)
    }
  }

  // imageUrls/links start from whatever the compose phase attached (see
  // handleGenerate), but are editable per draft below — add/remove
  // independent of what the batch default was. `d.blogLink` is read as a
  // fallback for drafts created before V8.1's move to a `links` array.
  function fieldsFor(d) {
    return edits[d.id] || {
      subject: d.draftSubject, body: d.draftBody, imageUrls: d.imageUrls || [],
      links: d.links || (d.blogLink ? [d.blogLink] : []),
    }
  }
  // Deliberately does NOT call fieldsFor() here (bug-fix pack C-01) — fieldsFor
  // reads the component's `edits` state via closure, which is frozen at
  // whatever render created THIS specific setField instance. handleBulkRewrite
  // holds onto one setField closure for its whole loop (many awaited network
  // calls, no re-render in between from its own perspective), so every
  // fieldsFor() call inside it was reading edits as of the render where "Apply
  // to all" was clicked — not the true latest state. It happened to
  // self-correct via prev[draftId] winning in the spread for keys already
  // touched, but that's incidental, not guaranteed — the one thing genuinely
  // safe to rely on inside a setState updater is `prev`, so the base now comes
  // from prev[draftId] first and only falls back to the ORIGINAL Firestore
  // draft fields (which don't change and need no closure) when this key has
  // never been touched at all.
  function setField(draftId, key, value) {
    setEdits(prev => {
      if (prev[draftId]) return { ...prev, [draftId]: { ...prev[draftId], [key]: value } }
      const d = drafts.find(x => x.id === draftId)
      const base = d
        ? { subject: d.draftSubject, body: d.draftBody, imageUrls: d.imageUrls || [], links: d.links || (d.blogLink ? [d.blogLink] : []) }
        : {}
      return { ...prev, [draftId]: { ...base, [key]: value } }
    })
  }

  async function handleSend(d) {
    const { subject, body, imageUrls, links } = fieldsFor(d)
    setBusyId(d.id); setError('')
    try {
      // recipientKind/recipientId: correlation for resend-webhook.js, so a
      // bounce/complaint on this send can update the actual customer/contact
      // record, not just this draft's own engagement flag (bug-fix pack C-04).
      await sendPersonalEmail({
        customerEmail: d.customerEmail, subject, body, draftId: d.id, imageUrls, links,
        recipientKind: d.source === 'contact' ? 'contact' : 'customer', recipientId: d.customerId,
      })
      const user = await authedUser()
      await markDraftSent(d.id, user?.uid)
      if (d.source === 'contact') {
        await markContactOutreach(d.customerId)
      } else {
        await updateDoc(doc(db, 'customers', d.customerId), { lastOutreachAt: serverTimestamp() })
      }
      // Auto-logged for BOTH sources as of V8.9 — see logInteraction's comment.
      await logInteraction(d.source, d.customerId, {
        description: `Sent Daily Drafts outreach email — ${subject}\n\n${body}`,
        channel: 'Email',
        productInterest: d.topicLabel || d.productName,
      })
      setDrafts(prev => prev.filter(x => x.id !== d.id))
      reloadSent()
    } catch (e) {
      setError(e.message || 'Send failed.')
    } finally {
      setBusyId(null)
    }
  }

  // "Send test to myself" (owner, 2026-08-22) — Mailchimp used to offer
  // exactly this: see how the actual email renders before it goes to a real
  // customer. Deliberately a THIN wrapper around the same send path handleSend
  // uses, not a separate preview renderer — an inbox is the only place that
  // actually proves subject line, image sizing, link formatting, and the
  // reply-to address all look right, the way DailyDrafts.jsx's own on-screen
  // edit form cannot.
  //
  // Three things keep this from being a real send in disguise:
  //   1. Goes to the SIGNED-IN ADMIN's own address (their Firebase Auth
  //      email), never the customer's — hardcoded here, not a field the
  //      owner could fat-finger into actually emailing the customer twice.
  //   2. No draftId/recipientKind/recipientId passed to sendPersonalEmail —
  //      without a draftId, send-personal-email.js attaches no Resend tags,
  //      so a test send can never surface as a false "delivered/opened" event
  //      on the real draft via resend-webhook.js.
  //   3. markDraftSent/lastOutreachAt/logInteraction are never called — the
  //      draft stays exactly where it was, in pending_review, fully editable
  //      and re-testable as many times as needed before the real Send.
  async function handleSendTest(d) {
    const { subject, body, imageUrls, links } = fieldsFor(d)
    const user = await authedUser()
    if (!user?.email) { setError('Could not determine your own sign-in email.'); return }
    setBusyId(`test-${d.id}`); setError('')
    try {
      await sendPersonalEmail({ customerEmail: user.email, subject: `[TEST] ${subject}`, body, imageUrls, links })
      setTestSentId(d.id)
      setTimeout(() => setTestSentId(id => (id === d.id ? null : id)), 5000)
    } catch (e) {
      setError(e.message || 'Test send failed.')
    } finally {
      setBusyId(null)
    }
  }

  // Opens the given WhatsApp number in a new tab and marks which channel was
  // opened (so "Log WhatsApp outreach" can appear with the right label) — it
  // does NOT log anything itself. Opening a link is not evidence a message
  // was actually sent; only Eddie's own explicit "Log" click is.
  function handleWhatsappOpen(d, channel, number) {
    window.open(`https://wa.me/${number.replace(/\D/g, '')}`, '_blank', 'noopener')
    setWhatsappOpened(prev => ({ ...prev, [d.id]: channel }))
  }

  // Manual, explicit confirmation only — mirrors handleSend's Email logging
  // exactly (same logInteraction call, now to either collection as of
  // V8.9). Guarded by whatsappLogged so a repeat click can't create a
  // duplicate entry.
  async function handleLogWhatsapp(d) {
    if (whatsappLogged[d.id]) return
    const channel = whatsappOpened[d.id] === 'personal' ? 'Personal WhatsApp'
      : whatsappOpened[d.id] === 'business' ? 'WhatsApp Business'
      : 'WhatsApp'
    setWhatsappLogged(prev => ({ ...prev, [d.id]: true }))
    try {
      await logInteraction(d.source, d.customerId, {
        description: `WhatsApp outreach opened via Daily Drafts (${d.topicLabel || d.productName || 'general'})`,
        channel,
        productInterest: d.topicLabel || d.productName,
      })
    } catch (e) {
      setWhatsappLogged(prev => ({ ...prev, [d.id]: false })) // failed — let Eddie retry
      setError(e.message || 'Could not log that outreach.')
    }
  }

  async function handleClearAllPending() {
    if (!drafts.length) return
    if (!window.confirm(`Delete all ${drafts.length} pending drafts? This can't be undone — use this for clearing out test/duplicate runs, not for real review.`)) return
    setError('')
    try {
      await deleteAllPending()
      reload()
    } catch (e) {
      setError(e.message || 'Could not clear pending drafts.')
    }
  }

  // No confirmation prompt — Skip is reviewing 10-20 of these at a time and a
  // blocking native dialog on every click was the complaint. skipReason stays
  // blank; historicalHints (see summarizeHistory) just has less to say about
  // WHY this one was skipped, which is an acceptable trade for not annoying
  // the one person actually using this daily.
  async function handleSkip(d) {
    setBusyId(d.id); setError('')
    try {
      const user = await authedUser()
      await skipDraft(d.id, user?.uid, '')
      setDrafts(prev => prev.filter(x => x.id !== d.id))
    } catch (e) {
      setError(e.message || 'Could not skip.')
    } finally {
      setBusyId(null)
    }
  }

  const BLOCK_DAYS = 90 // "I'm already talking to this person" pause — see customerToEntity's comment

  // The real "don't suggest this person" signal isn't a CRM status, it's the
  // owner's own knowledge of who they're already emailing manually — nothing
  // in the app can detect that (no email visibility yet). This is that
  // knowledge made actionable: pause them for BLOCK_DAYS and skip the
  // current draft in the same action.
  async function handleBlockOutreach(d) {
    setBusyId(d.id); setError('')
    try {
      const until = new Date(Date.now() + BLOCK_DAYS * 86400000)
      if (d.source === 'contact') {
        await blockContactOutreach(d.customerId, until)
      } else {
        await updateDoc(doc(db, 'customers', d.customerId), { blockOutreachUntil: until })
      }
      const user = await authedUser()
      await skipDraft(d.id, user?.uid, `Already in direct contact — paused ${BLOCK_DAYS} days`)
      setDrafts(prev => prev.filter(x => x.id !== d.id))
    } catch (e) {
      setError(e.message || 'Could not pause this person.')
    } finally {
      setBusyId(null)
    }
  }

  // Replies very often land somewhere other than email (WhatsApp/WeChat/
  // Alibaba, not this app's inbox — Resend's webhook only ever sees the
  // OUTBOUND send, never a reply on another channel). This logs the reply
  // both on the draft itself (a Daily-Drafts-local record) and — the part
  // that actually matters — onto the real CRM Interaction Log (either
  // collection as of V8.9), the same one CustomerDetail.jsx's "+ Log
  // Interaction" writes to for customers, so it shows up there regardless
  // of which channel it came in on.
  async function handleLogReply(d) {
    const channel = replyChannel[d.id] || REPLY_CHANNELS[0]
    const text = (replyText[d.id] || '').trim()
    setBusyId(d.id); setError('')
    try {
      await markDraftReplied(d.id, { channel, replyText: text })
      const description = `Replied via ${channel}${text ? `: ${text}` : ''}`
      await logInteraction(d.source, d.customerId, { description, channel, productInterest: d.topicLabel || d.productName })
      setSentDrafts(prev => prev.map(x => x.id === d.id ? { ...x, repliedAt: new Date(), repliedChannel: channel, replyText: text } : x))
      setReplyFormOpenId(null)
      setReplyText(prev => ({ ...prev, [d.id]: '' }))
    } catch (e) {
      setError(e.message || 'Could not log that reply.')
    } finally {
      setBusyId(null)
    }
  }

  // Lazily loads and caches a linked product's public images, keyed by
  // "source:productId" (not draftId — every draft in a batch shares the same
  // product, no need to fetch the same gallery once per draft). Range images
  // resolve from the already-loaded `products` list (their gallery is an
  // inline array, not a subcollection — see loadBlogImages) rather than a
  // fresh Firestore read.
  async function ensureProductImages(pid, source) {
    const key = `${source || 'corporate'}:${pid}`
    if (!pid || productImagesCache[key]) return
    const product = products.find(p => p.id === pid && p.source === (source || 'corporate')) || { id: pid }
    const imgs = await loadBlogImages(source || 'corporate', product)
    setProductImagesCache(prev => ({ ...prev, [key]: imgs.filter(isPublicVisible) }))
  }

  function toggleDraftImage(d, url) {
    const cur = fieldsFor(d).imageUrls || []
    const next = cur.includes(url) ? cur.filter(u => u !== url) : (cur.length < MAX_ATTACHED_IMAGES ? [...cur, url] : cur)
    setField(d.id, 'imageUrls', next)
  }
  function removeDraftImage(d, url) {
    setField(d.id, 'imageUrls', (fieldsFor(d).imageUrls || []).filter(u => u !== url))
  }
  function removeDraftLink(d, url) {
    setField(d.id, 'links', (fieldsFor(d).links || []).filter(l => l.url !== url))
  }
  function applyDraftLink(d) {
    const url = (draftLinkUrl[d.id] || '').trim()
    if (!url) return
    const title = (draftLinkTitle[d.id] || '').trim() || url
    setField(d.id, 'links', [...(fieldsFor(d).links || []), { title, url }])
    setDraftLinkUrl(prev => ({ ...prev, [d.id]: '' }))
    setDraftLinkTitle(prev => ({ ...prev, [d.id]: '' }))
    setLinkFormOpenId(null)
  }

  // Draft has no linked product to pick a photo from (a generic topic) —
  // direct upload instead, same helper the Compose phase uses.
  async function handleDraftUpload(d, file) {
    if (!file || (fieldsFor(d).imageUrls || []).length >= MAX_ATTACHED_IMAGES) return
    setDraftUploading(d.id); setError('')
    try {
      const url = await uploadImage(file)
      setField(d.id, 'imageUrls', [...(fieldsFor(d).imageUrls || []), url])
    } catch (e) {
      setError(e.message || 'Upload failed.')
    } finally {
      setDraftUploading(null)
    }
  }

  // Draft Memory Layer (V8.9) — live contact summary at send time, not just
  // whatever was baked into customerContext when the draft was generated
  // (which could be stale if the summary's been edited since). Only
  // marketing_contacts has this field in Phase 1 — see contactToEntity's
  // comment on why customers/ isn't wired up yet.
  async function contactSummaryFor(d) {
    if (d.source !== 'contact') return ''
    try {
      const snap = await getDoc(doc(db, 'marketing_contacts', d.customerId))
      return snap.exists() ? (snap.data()?.ai_context_summary || '') : ''
    } catch { return '' }
  }

  async function handleChatSend(d) {
    const message = (chatInput[d.id] || '').trim()
    if (!message) return
    const history = chatHistory[d.id] || []
    const fields = fieldsFor(d)
    setChatBusy(d.id); setError('')
    try {
      const contactSummary = await contactSummaryFor(d)
      const result = await discussDraft({
        productContext: d.productName || d.topicLabel,
        customerContext: d.customerContext,
        draftSubject: fields.subject,
        draftBody: fields.body,
        history,
        message,
        memory: { globalRules: activeRuleTexts, contactSummary, recentConclusions: d.memory_conclusions || [] },
      })
      const changed = !!(result.subject || result.body)
      // Heuristic mismatch flag (2026-08-22 — a real observed failure): the
      // system prompt now tells the model never to claim a change while
      // returning null/null, but this catches it in the UI if it slips
      // anyway, rather than the draft silently not moving with no signal why.
      const claimsChange = /\b(updated?|added|changed|rewrote|revised|here'?s the (updated|new))\b/i.test(result.reply || '')
      setChatHistory(prev => ({
        ...prev,
        [d.id]: [...history, { role: 'user', content: message },
          { role: 'assistant', content: result.reply, applied: changed || !claimsChange }],
      }))
      setChatInput(prev => ({ ...prev, [d.id]: '' }))
      if (result.subject) setField(d.id, 'subject', result.subject)
      if (result.body) setField(d.id, 'body', result.body)
    } catch (e) {
      setError(e.message || 'Chat failed.')
    } finally {
      setChatBusy(null)
    }
  }

  async function handleBulkRewrite() {
    const instruction = bulkRewriteInput.trim()
    if (!instruction || bulkRewriteBusy) return
    setBulkRewriteBusy(true); setBulkRewriteError('')
    const targets = drafts // snapshot — sent/skipped mid-run naturally drop out of `drafts` but this loop already captured its list
    let failCount = 0
    for (let i = 0; i < targets.length; i++) {
      const d = targets[i]
      setBulkRewriteProgress({ done: i, total: targets.length })
      const fields = fieldsFor(d)
      const history = chatHistory[d.id] || []
      try {
        const contactSummary = await contactSummaryFor(d)
        const result = await discussDraft({
          productContext: d.productName || d.topicLabel,
          customerContext: d.customerContext,
          draftSubject: fields.subject,
          draftBody: fields.body,
          history,
          message: instruction,
          memory: { globalRules: activeRuleTexts, contactSummary, recentConclusions: d.memory_conclusions || [] },
        })
        if (result.subject) setField(d.id, 'subject', result.subject)
        if (result.body) setField(d.id, 'body', result.body)
        // Recorded on each draft's own chat thread too — so opening it
        // afterward shows the bulk instruction was what changed it, not a
        // silent edit with no explanation.
        setChatHistory(prev => ({
          ...prev,
          [d.id]: [...history, { role: 'user', content: instruction }, { role: 'assistant', content: result.reply }],
        }))
      } catch {
        failCount++
      }
    }
    setBulkRewriteProgress({ done: targets.length, total: targets.length })
    setBulkRewriteBusy(false)
    setBulkRewriteInput('')
    if (failCount) setBulkRewriteError(`${failCount} of ${targets.length} draft(s) could not be rewritten — the rest were updated.`)
    setTimeout(() => setBulkRewriteProgress(null), 2000)
  }

  // Pushes the owner's OWN message text onto the customer/contact's CRM
  // notes, verbatim — no AI involved in deciding what's worth keeping (see
  // discuss-outreach-draft.js's header comment on why this is a separate,
  // explicit action rather than something the AI does automatically).
  async function handleSaveNote(d, text) {
    try {
      if (d.source === 'contact') await appendNote('marketing_contacts', d.customerId, 'app_notes', text)
      else await appendNote('customers', d.customerId, 'notes', text)
    } catch (e) {
      setError(e.message || 'Could not save that note.')
    }
  }

  // Draft Memory Layer (V8.9) — "remember this for THIS draft only": a short
  // conclusion fed back into this draft's own rewrite prompt (see
  // handleChatSend's memory.recentConclusions), not every future draft the
  // way handleRememberRule's global rules are. Updates local state too so
  // the very next chat turn on this draft already has it, without a reload.
  async function handleRememberConclusion(d, text) {
    try {
      const next = await appendMemoryConclusion(d.id, d.memory_conclusions, text)
      setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, memory_conclusions: next } : x))
    } catch (e) {
      setError(e.message || 'Could not save that for this draft.')
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  const hasMaster = masterSubject.trim() && masterBody.trim()

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-8">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {/* ── Draft Memory Layer (V8.9) — global writing rules review ──────
          Nothing here reaches a prompt until approved (activeRuleTexts
          filters to status:'active' only) — pending is just a holding pen
          for what handleRememberRule() proposed. */}
      <div className="card p-4 space-y-3">
        <button type="button" onClick={() => setMemoryPanelOpen(!memoryPanelOpen)}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-900">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple-500" /> Draft memory — standing rules
            {pendingRules.length > 0 && (
              <span className="text-[11px] font-normal bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                {pendingRules.length} pending review
              </span>
            )}
          </span>
          {memoryPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {memoryPanelOpen && (
          <div className="space-y-4">
            {pendingRules.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500">Pending — not used in any draft yet</p>
                {pendingRules.map(r => (
                  <div key={r.id} className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                    <span className="min-w-0 flex-1">{r.text}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleApproveRule(r.id)}
                        className="text-xs text-green-700 hover:text-green-800 font-medium disabled:opacity-50">Approve</button>
                      <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleRejectRule(r.id)}
                        className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">
                Active — used in every draft/rewrite ({activeRules.length}/{MAX_ACTIVE_RULES})
              </p>
              {activeRules.length === 0 && <p className="text-xs text-gray-400">None yet — approve a pending rule, or add one directly below.</p>}
              {activeRules.map(r => (
                <div key={r.id} className="flex items-start gap-2 text-sm bg-ivory-light rounded px-2.5 py-1.5">
                  {editingRuleId === r.id ? (
                    <>
                      <input value={editingRuleText} onChange={e => setEditingRuleText(e.target.value)}
                        className="input flex-1 text-sm py-1" autoFocus />
                      <button type="button" onClick={() => handleSaveRuleEdit(r.id)} className="text-xs text-brand-600 font-medium shrink-0">Save</button>
                      <button type="button" onClick={() => setEditingRuleId(null)} className="text-xs text-gray-400 shrink-0">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">{r.text}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={() => { setEditingRuleId(r.id); setEditingRuleText(r.text) }}
                          className="text-xs text-gray-400 hover:text-brand-600">Edit</button>
                        <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleDisableRule(r.id)}
                          className="text-xs text-gray-400 hover:text-amber-600 disabled:opacity-50">Disable</button>
                        <button type="button" disabled={memoryRuleBusy === r.id} onClick={() => handleDeleteRule(r.id)}
                          className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1 border-t border-ivory-dark">
              <input value={newRuleText} onChange={e => setNewRuleText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddRuleDirect()}
                placeholder="Add a rule directly, e.g. &quot;Always sign off as Eddie, never 'The Crystocraft Team'&quot;"
                className="input flex-1 text-sm" />
              <button type="button" onClick={handleAddRuleDirect} disabled={!newRuleText.trim()} className="btn-secondary text-xs px-3">
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 1. Compose ─────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">1. What do you want to say?</h2>

        <div className="flex items-center gap-2 flex-wrap">
          {!linkedProduct ? (
            <button type="button" onClick={() => setLinkProductOpen(!linkProductOpen)}
              className="text-xs text-gray-400 hover:text-brand-600">
              + Link a product (optional, unlocks its photos)
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-sm bg-ivory-light rounded px-2 py-1">
              <span className="truncate max-w-xs">{linkedProduct.name}</span>
              <button type="button" onClick={() => setLinkedProduct(null)} className="text-gray-400 hover:text-red-600">
                <X size={12} />
              </button>
            </div>
          )}
          {/* Any URL — crystocraft.com blog post included. Moved up here
              (owner, 2026-08-22) from further down where it only appeared
              after "Draft with AI" — the blog link is chosen at the same
              time as the product link, not after drafting. WordPress search
              was tried and retired in V8.1 (503s from the WP host made it
              unreliable) — paste the URL in by hand instead, same posture
              as send-personal-email.js's own `links` field. */}
          {masterLinks.map(l => (
            <span key={l.url} className="inline-flex items-center gap-1 text-xs text-gray-500 bg-ivory-light rounded px-2 py-1">
              <Link2 size={11} /> {l.title}
              <button type="button" onClick={() => removeMasterLink(l.url)} className="text-gray-400 hover:text-red-600">
                <X size={11} />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => setMasterLinkFormOpen(!masterLinkFormOpen)}
            className="text-xs text-gray-400 hover:text-brand-600">
            + Link a blog post or page (optional)
          </button>
        </div>
        {linkProductOpen && !linkedProduct && (
          <div>
            <input value={linkProductQuery} onChange={e => setLinkProductQuery(e.target.value)}
              placeholder="Search Corporate Gifts or Crystocraft Range…" className="input w-full md:w-96 mb-1" />
            <div className="border border-ivory-dark rounded max-h-48 overflow-y-auto w-full md:w-96">
              {filteredLinkProducts.map(p => (
                <button key={`${p.source}-${p.id}`} type="button"
                  onClick={() => { setLinkedProduct(p); setLinkProductOpen(false); setLinkProductQuery('') }}
                  className="w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 text-sm hover:bg-ivory-light">
                  <span className="truncate">{p.name}</span>
                  <span className={`text-[10px] uppercase tracking-wide rounded px-1 py-0.5 shrink-0 ${
                    p.source === 'range' ? 'bg-brand-50 text-brand-700' : 'bg-blue-50 text-blue-700'
                  }`}>
                    {p.source === 'range' ? 'Range' : 'Corporate'}
                  </span>
                </button>
              ))}
              {!filteredLinkProducts.length && <div className="px-3 py-1.5 text-sm text-gray-400">No matches.</div>}
            </div>
          </div>
        )}
        {masterLinkFormOpen && (
          <div className="border border-ivory-dark rounded p-2 space-y-2 w-full md:w-96">
            <input value={masterLinkUrl} onChange={e => setMasterLinkUrl(e.target.value)}
              placeholder="https://www.crystocraft.com/blog/…" className="input w-full text-sm" />
            <input value={masterLinkTitle} onChange={e => setMasterLinkTitle(e.target.value)}
              placeholder="Link text (optional)" className="input w-full text-sm" />
            <div className="flex gap-2">
              <button type="button" onClick={applyMasterLink} disabled={!masterLinkUrl.trim()} className="btn-secondary text-xs py-1.5 px-3">
                Attach link
              </button>
              <button type="button" onClick={() => setMasterLinkFormOpen(false)} className="text-xs text-gray-400 hover:text-brand-600">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Topic</label>
          <textarea value={topic} onChange={e => setTopic(e.target.value)} rows={2}
            placeholder={'e.g. "News and update on what we\'ve been up to" or "Invite long-time customers to try the new customer portal"'}
            className="input w-full text-sm" />
          <button onClick={handleDraftTopic} disabled={drafting || !topic.trim()}
            className="btn-primary mt-2 inline-flex items-center gap-1.5">
            {drafting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {drafting ? 'Drafting…' : hasMaster ? 'Draft again' : 'Draft with AI'}
          </button>
        </div>

        {hasMaster && (
          <>
            <input value={masterSubject} onChange={e => setMasterSubject(e.target.value)}
              className="input w-full text-sm font-medium" placeholder="Subject" />
            <textarea value={masterBody} onChange={e => setMasterBody(e.target.value)} rows={4}
              className="input w-full text-sm" placeholder="Message" />

            <div>
              <button type="button" onClick={() => setMasterChatOpen(!masterChatOpen)}
                className="text-xs text-gray-500 hover:text-brand-600 inline-flex items-center gap-1">
                <MessageCircle size={13} /> {masterChatOpen ? 'Close' : 'Rewrite / fine-tune with AI'}
              </button>
              {masterChatOpen && (
                <div className="border border-ivory-dark rounded-lg p-3 bg-ivory-light space-y-2 mt-2">
                  {masterChatHistory.length > 0 && (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {masterChatHistory.map((h, i) => (
                        <div key={i} className={`text-sm flex items-start gap-1.5 ${h.role === 'assistant' ? 'text-gray-700' : 'text-gray-900'}`}>
                          <span className="min-w-0"><span className="font-medium">{h.role === 'assistant' ? 'AI:' : 'You:'}</span> {h.content}</span>
                          {h.role === 'user' && (
                            <button type="button" onClick={() => handleRememberRule(h.content)}
                              title="Remember this as a standing rule for every future draft (goes to review first)"
                              className="text-gray-400 hover:text-brand-600 shrink-0">
                              <Bookmark size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input value={masterChatInput} onChange={e => setMasterChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !masterChatBusy && handleMasterChatSend()}
                      placeholder="e.g. shorter, and mention the summer catalogue"
                      className="input w-full text-sm" autoFocus
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                      data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
                      data-lpignore="true" data-1p-ignore="true" />
                    <button type="button" onClick={handleMasterChatSend} disabled={masterChatBusy} className="btn-secondary shrink-0">
                      {masterChatBusy ? <Loader2 size={14} className="animate-spin" /> : 'Send'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {masterImageUrls.map(url => (
                <div key={url} className="relative">
                  <img src={url} alt="" className="w-10 h-10 rounded object-cover border border-ivory-dark" />
                  <button type="button" onClick={() => setMasterImageUrls(prev => prev.filter(u => u !== url))}
                    className="absolute -top-1.5 -right-1.5 bg-white rounded-full border border-ivory-dark text-gray-400 hover:text-red-600">
                    <X size={11} />
                  </button>
                </div>
              ))}
              {masterImageUrls.length < MAX_ATTACHED_IMAGES && (
                <label className="text-xs text-gray-400 hover:text-brand-600 border border-dashed border-ivory-dark rounded px-2 py-1.5 cursor-pointer inline-flex items-center gap-1">
                  {masterUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Upload
                  <input type="file" accept="image/*" className="hidden" disabled={masterUploading}
                    onChange={e => { handleMasterUpload(e.target.files?.[0]); e.target.value = '' }} />
                </label>
              )}
            </div>

            {linkedProduct && linkedProductImages.length > 0 && masterImageUrls.length < MAX_ATTACHED_IMAGES && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">…or from {linkedProduct.name}'s gallery</label>
                <div className="flex flex-wrap gap-2">
                  {linkedProductImages.map(img => {
                    const picked = masterImageUrls.includes(img.file_url)
                    return (
                      <button key={img.id || img.file_url} type="button" onClick={() => toggleMasterImage(img.file_url)}
                        className={`relative w-12 h-12 rounded overflow-hidden border-2 ${picked ? 'border-brand-600' : 'border-transparent'}`}>
                        <img src={img.file_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

          </>
        )}
      </div>

      {/* ── 2. Target & Generate ───────────────────────────────────────── */}
      <div className={`card p-5 space-y-4 ${!hasMaster ? 'opacity-50' : ''}`}>
        <h2 className="text-sm font-semibold text-gray-900">2. Who do you want to reach?</h2>
        {/* Hard pre-filter, not a hint — see handleGenerate's own comment on
            why this can't just be folded into the free-text Targeting note
            below (the AI can ignore/misread free text; this can't be). */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Audience</label>
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { v: 'b2b', label: 'B2B customers' },
              { v: 'retail', label: 'Retail customers only' },
              { v: 'all', label: 'Everyone' },
            ].map(opt => (
              <label key={opt.v} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="radio" name="audienceFilter" value={opt.v} checked={audienceFilter === opt.v}
                  disabled={!hasMaster} onChange={() => setAudienceFilter(opt.v)} />
                {opt.label}
              </label>
            ))}
          </div>
          {audienceFilter === 'b2b' && (
            <div className="flex items-center gap-3 flex-wrap mt-2">
              {CRM_CATEGORIES.map(cat => (
                <label key={cat} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={categoryFilter.includes(cat)} disabled={!hasMaster}
                    onChange={e => setCategoryFilter(prev => e.target.checked ? [...prev, cat] : prev.filter(c => c !== cat))} />
                  {cat}
                </label>
              ))}
              <span className="text-[11px] text-gray-400">{categoryFilter.length ? '' : '(none checked = all categories)'}</span>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Targeting (optional)</label>
          <input value={targetingNote} onChange={e => setTargetingNote(e.target.value)} disabled={!hasMaster}
            placeholder='e.g. "Hong Kong corporate gift customers" or "Crystocraft distributors in Europe"'
            className="input w-full md:w-96" />
          <div className="text-[11px] text-gray-400 mt-1">Leave blank and DeepSeek picks who's most relevant on its own judgment.</div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={includeAlreadyContacted} disabled={!hasMaster}
            onChange={e => setIncludeAlreadyContacted(e.target.checked)} />
          Include people already contacted about this (drafted as a reminder, not a repeat pitch)
        </label>
        <button onClick={handleGenerate} disabled={generating || !hasMaster} className="btn-primary inline-flex items-center gap-1.5">
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generating ? 'Generating…' : 'Generate Drafts'}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Pending review ({drafts.length})</h2>
          {drafts.length > 0 && (
            <div className="flex items-center gap-3">
              <button onClick={() => setBulkRewriteOpen(v => !v)} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
                <Sparkles size={12} /> Bulk rewrite
              </button>
              <button onClick={handleClearAllPending} className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1">
                <Trash2 size={12} /> Clear all pending
              </button>
            </div>
          )}
        </div>

        {bulkRewriteOpen && drafts.length > 0 && (
          <div className="border border-ivory-dark rounded-lg p-3 bg-ivory-light space-y-2">
            <p className="text-xs text-gray-500">
              Applies to all {drafts.length} pending draft{drafts.length === 1 ? '' : 's'} — same instruction, sent
              to each one individually (a real AI call per draft, so this takes a moment for a large batch).
            </p>
            <div className="flex gap-2">
              <input
                value={bulkRewriteInput}
                onChange={e => setBulkRewriteInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !bulkRewriteBusy && handleBulkRewrite()}
                placeholder="e.g. sign off with 'Best regards, Eddie' instead"
                className="input w-full text-sm" autoFocus
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                name="bulk-rewrite-input"
                data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
                data-lpignore="true" data-1p-ignore="true"
                data-dashlane-ignore="true" data-bwignore="true" data-form-type="other"
                data-ms-editor="false"
              />
              <button type="button" onClick={handleBulkRewrite} disabled={bulkRewriteBusy || !bulkRewriteInput.trim()} className="btn-secondary shrink-0">
                {bulkRewriteBusy ? <Loader2 size={14} className="animate-spin" /> : 'Apply to all'}
              </button>
            </div>
            {bulkRewriteProgress && (
              <p className="text-xs text-gray-500">Rewrote {bulkRewriteProgress.done} of {bulkRewriteProgress.total}…</p>
            )}
            {bulkRewriteError && <p className="text-xs text-red-600">{bulkRewriteError}</p>}
          </div>
        )}

        {drafts.length === 0 && <div className="text-sm text-gray-400">No drafts waiting — generate some above.</div>}
        {drafts.map(d => {
          const fields = fieldsFor(d)
          const isBusy = busyId === d.id
          const isChatOpen = chatOpenId === d.id
          const isChatBusy = chatBusy === d.id
          const history = chatHistory[d.id] || []
          const isAddCustomerOpen = addCustomerOpenId === d.id
          return (
            <div key={d.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {d.customerName} <span className="text-gray-400 font-normal">— {d.customerEmail}</span>
                    <SourceBadge source={d.source} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {d.productName || d.topicLabel} · fit {Math.round((d.fitScore || 0) * 100)}%
                    {d.fitReason && <span className="text-gray-400"> — {d.fitReason}</span>}
                  </div>
                  {d.contextSources?.length > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      {d.contextSources.includes('email') && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="This draft used the customer's ingested email history">
                          <Mail size={11} /> Email history
                        </span>
                      )}
                      {d.contextSources.includes('whatsapp') && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="This draft used the customer's imported WhatsApp history">
                          <Smartphone size={11} /> WhatsApp history
                        </span>
                      )}
                      {d.contextSources.includes('notes') && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="This draft used the CRM notes field">
                          <FileText size={11} /> CRM notes
                        </span>
                      )}
                      {d.contextSources.includes('invoices') && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="This draft used recent ERP order history">
                          <Receipt size={11} /> Recent orders
                        </span>
                      )}
                      {d.contextSources.includes('memory') && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500" title="This draft used the contact's saved AI writing preferences">
                          <Sparkles size={11} /> Memory
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <input value={fields.subject} onChange={e => setField(d.id, 'subject', e.target.value)}
                className="input w-full text-sm font-medium" />
              <textarea value={fields.body} onChange={e => setField(d.id, 'body', e.target.value)}
                rows={4} className="input w-full text-sm" />
              <div className="flex items-center gap-2 flex-wrap">
                {(fields.imageUrls || []).map(url => (
                  <div key={url} className="relative">
                    <img src={url} alt="" className="w-10 h-10 rounded object-cover border border-ivory-dark" />
                    <button type="button" onClick={() => removeDraftImage(d, url)}
                      className="absolute -top-1.5 -right-1.5 bg-white rounded-full border border-ivory-dark text-gray-400 hover:text-red-600">
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {(fields.imageUrls || []).length < MAX_ATTACHED_IMAGES && (
                  d.productId ? (
                    <button type="button"
                      onClick={() => { setPhotoPickerOpenId(photoPickerOpenId === d.id ? null : d.id); ensureProductImages(d.productId, d.productSource) }}
                      className="text-xs text-gray-400 hover:text-brand-600 border border-dashed border-ivory-dark rounded px-2 py-1.5">
                      + Photo
                    </button>
                  ) : (
                    <label className="text-xs text-gray-400 hover:text-brand-600 border border-dashed border-ivory-dark rounded px-2 py-1.5 cursor-pointer inline-flex items-center gap-1">
                      {draftUploading === d.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                      Upload
                      <input type="file" accept="image/*" className="hidden" disabled={draftUploading === d.id}
                        onChange={e => { handleDraftUpload(d, e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  )
                )}
                {(fields.links || []).map(l => (
                  <span key={l.url} className="inline-flex items-center gap-1 text-xs text-gray-500 bg-ivory-light rounded px-2 py-1">
                    <Link2 size={11} /> {l.title}
                    <button type="button" onClick={() => removeDraftLink(d, l.url)} className="text-gray-400 hover:text-red-600">
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setLinkFormOpenId(linkFormOpenId === d.id ? null : d.id)}
                  className="text-xs text-gray-400 hover:text-brand-600 border border-dashed border-ivory-dark rounded px-2 py-1.5">
                  + Link
                </button>
              </div>

              {photoPickerOpenId === d.id && (
                <div className="flex flex-wrap gap-2 border border-ivory-dark rounded p-2">
                  {(productImagesCache[`${d.productSource || 'corporate'}:${d.productId}`] || []).map(img => (
                    <button key={img.id || img.file_url} type="button" onClick={() => toggleDraftImage(d, img.file_url)}
                      className={`relative w-12 h-12 rounded overflow-hidden border-2 ${(fields.imageUrls || []).includes(img.file_url) ? 'border-brand-600' : 'border-transparent'}`}>
                      <img src={img.file_url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                  {!(productImagesCache[`${d.productSource || 'corporate'}:${d.productId}`] || []).length && <div className="text-xs text-gray-400 py-1">No public photos for this product.</div>}
                </div>
              )}

              {linkFormOpenId === d.id && (
                <div className="border border-ivory-dark rounded p-2 space-y-2">
                  <input value={draftLinkUrl[d.id] || ''}
                    onChange={e => setDraftLinkUrl(prev => ({ ...prev, [d.id]: e.target.value }))}
                    placeholder="https://…" className="input w-full text-sm" />
                  <input value={draftLinkTitle[d.id] || ''}
                    onChange={e => setDraftLinkTitle(prev => ({ ...prev, [d.id]: e.target.value }))}
                    placeholder="Link text (optional)" className="input w-full text-sm" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => applyDraftLink(d)} disabled={!(draftLinkUrl[d.id] || '').trim()} className="btn-secondary text-xs py-1.5 px-3">
                      Attach link
                    </button>
                    <button type="button" onClick={() => setLinkFormOpenId(null)} className="text-xs text-gray-400 hover:text-brand-600">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {/* flex-wrap: this row overflowed horizontally on both desktop
                  and mobile once "Send test to myself" (V8.7) joined
                  Send/Skip/Already in contact — four full-width buttons plus
                  the trailing actions never fit one line below ~1400px, and
                  a non-wrapping flex row just clips/scrolls instead of
                  reflowing. gap-y-2 gives wrapped rows breathing room. */}
              <div className="flex items-center gap-2 flex-wrap gap-y-2">
                <button onClick={() => handleSend(d)} disabled={isBusy} className="btn-primary shrink-0 inline-flex items-center gap-1.5">
                  {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {isBusy ? 'Sending…' : 'Send'}
                </button>
                <button onClick={() => handleSkip(d)} disabled={isBusy} className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
                  <SkipForward size={14} /> Skip
                </button>
                <button onClick={() => handleBlockOutreach(d)} disabled={isBusy}
                  title={`Already talking to them directly — don't suggest for ${BLOCK_DAYS} days`}
                  className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
                  <BellOff size={14} /> Already in contact
                </button>
                {(() => {
                  const isTestBusy = busyId === `test-${d.id}`
                  return (
                    <button onClick={() => handleSendTest(d)} disabled={isBusy || isTestBusy}
                      title="Send this exact email to your own inbox first — nothing here is sent to the customer or recorded"
                      className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
                      {isTestBusy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
                      {isTestBusy ? 'Sending test…' : 'Send test to myself'}
                    </button>
                  )
                })()}
                {testSentId === d.id && (
                  <span className="text-xs text-green-700 inline-flex items-center gap-1">
                    <CheckCircle2 size={13} /> Test sent — check your inbox
                  </span>
                )}
                {/* w-full on mobile: forces this group onto its own line
                    instead of squeezing beside the action buttons above once
                    wrapped — sm:w-auto/sm:ml-auto restores the "push right"
                    layout once there's room (desktop). */}
                <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-3 flex-wrap">
                  {d.source === 'contact' && !addCustomerDone[d.id] && (
                    <button type="button" onClick={() => openAddCustomer(d)}
                      className="text-xs text-gray-500 hover:text-brand-600 inline-flex items-center gap-1">
                      <UserPlus size={13} /> {isAddCustomerOpen ? 'Close' : 'Add to Customers'}
                    </button>
                  )}
                  {addCustomerDone[d.id] && (
                    <span className="text-xs text-green-600 inline-flex items-center gap-1">
                      <Check size={13} /> {addCustomerDone[d.id]}
                    </span>
                  )}
                  <button onClick={() => setChatOpenId(isChatOpen ? null : d.id)}
                    className="text-xs text-gray-500 hover:text-brand-600 inline-flex items-center gap-1">
                    <MessageCircle size={13} /> {isChatOpen ? 'Close' : 'Discuss with AI'}
                  </button>
                </div>
              </div>

              {/* WhatsApp quick access (Draft Daily WhatsApp channel support,
                  2026-08-19) — a manual open/copy action, never an auto-send.
                  Both numbers known -> two labelled buttons, never guessed.
                  Only one -> a single labelled button. Neither -> nothing
                  (no dead button). Legacy unclassified whatsapp -> a neutral
                  "WhatsApp" button, never relabeled Personal/Business without
                  evidence. */}
              {(() => {
                const hasPersonal = !!d.whatsapp_personal
                const hasBusiness = !!d.whatsapp_business
                const hasNeutral = !hasPersonal && !hasBusiness && !!d.whatsapp
                if (!hasPersonal && !hasBusiness && !hasNeutral) return null
                const chip = (label, channel, number) => (
                  <span key={channel} className="inline-flex items-center gap-1 rounded-full border border-gray-200 pl-1 pr-0.5 py-0.5">
                    <button type="button" onClick={() => handleWhatsappOpen(d, channel, number)}
                      className="text-xs text-gray-700 hover:text-brand-700 inline-flex items-center gap-1 px-1.5 py-0.5">
                      <Smartphone size={12} />{label}
                    </button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(number)}
                      title={`Copy ${label} number`} className="text-gray-300 hover:text-brand-600 px-1 py-0.5 text-[10px]">
                      Copy
                    </button>
                  </span>
                )
                return (
                  <div className="flex items-center gap-2 flex-wrap -mt-1">
                    {hasPersonal && chip('WhatsApp Personal', 'personal', d.whatsapp_personal)}
                    {hasBusiness && chip('WhatsApp Business', 'business', d.whatsapp_business)}
                    {hasNeutral && chip('WhatsApp', 'unknown', d.whatsapp)}
                    {whatsappOpened[d.id] && !whatsappLogged[d.id] && (
                      <button type="button" onClick={() => handleLogWhatsapp(d)}
                        className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
                        <Check size={12} /> Log WhatsApp outreach
                      </button>
                    )}
                    {whatsappLogged[d.id] && (
                      <span className="text-xs text-green-600 inline-flex items-center gap-1">
                        <Check size={12} /> Logged
                      </span>
                    )}
                  </div>
                )
              })()}

              {isAddCustomerOpen && (
                <div className="border border-ivory-dark rounded-lg p-3 bg-ivory-light space-y-2">
                  <div className="flex gap-1.5">
                    {[{ key: 'new', label: 'Create as new customer' }, { key: 'existing', label: 'Add as a contact on an existing customer' }].map(opt => (
                      <button key={opt.key} type="button" onClick={() => { setAddCustomerMode(opt.key); setAddCustomerError('') }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          addCustomerMode === opt.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {addCustomerMode === 'new' ? (
                    <>
                      <p className="text-xs text-gray-500">
                        Creates a new customer record from {d.customerName}'s lead info (company/name/email/phone/country) and links this lead to it.
                      </p>
                      <button type="button" onClick={() => handleCreateNewCustomer(d)} disabled={addCustomerBusy} className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                        {addCustomerBusy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                        {addCustomerBusy ? 'Creating…' : 'Create customer'}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">
                        Appends {d.customerName} as an extra contact on an existing customer — for a second person at a company already in the CRM.
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <CustomerPicker customers={pickerCustomers} value={addCustomerPickId} onChange={setAddCustomerPickId} />
                        <button type="button" onClick={() => handleAddAsContact(d)} disabled={addCustomerBusy || !addCustomerPickId} className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                          {addCustomerBusy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                          {addCustomerBusy ? 'Adding…' : 'Add contact'}
                        </button>
                      </div>
                    </>
                  )}
                  {addCustomerError && <p className="text-xs text-red-600">{addCustomerError}</p>}
                </div>
              )}

              {isChatOpen && (
                <div className="border border-ivory-dark rounded-lg p-3 bg-ivory-light space-y-2">
                  {history.length > 0 && (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {history.map((h, i) => (
                        <div key={i} className={`text-sm ${h.role === 'assistant' ? 'text-gray-700' : 'text-gray-900'}`}>
                          <div className="flex items-start gap-1.5">
                            <span className="font-medium shrink-0">{h.role === 'assistant' ? 'AI:' : 'You:'}</span>
                            <span className="min-w-0">{h.content}</span>
                            {h.role === 'user' && (
                              <span className="flex items-center gap-1 shrink-0">
                                <button type="button" onClick={() => handleSaveNote(d, h.content)}
                                  title="Save this as a note on the customer record"
                                  className="text-gray-400 hover:text-brand-600">
                                  <Bookmark size={12} />
                                </button>
                                <button type="button" onClick={() => handleRememberConclusion(d, h.content)}
                                  title="Remember for THIS draft only (feeds this draft's rewrite chat)"
                                  className="text-gray-400 hover:text-blue-600">
                                  <Bookmark size={12} className="fill-current" style={{ opacity: 0.3 }} />
                                </button>
                                <button type="button" onClick={() => handleRememberRule(h.content)}
                                  title="Remember as a standing rule for every future draft (goes to review first)"
                                  className="text-gray-400 hover:text-purple-600">
                                  <Sparkles size={12} />
                                </button>
                              </span>
                            )}
                          </div>
                          {/* h.applied === false means the AI's own reply text
                              claimed a change while returning null for both
                              subject and body — a real, observed failure mode
                              (2026-08-22) where the model says "I've updated
                              the email" but the draft above never moves. This
                              makes that mismatch visible instead of silently
                              confusing — say it again or reword the request. */}
                          {h.role === 'assistant' && h.applied === false && (
                            <p className="text-[11px] text-amber-700 ml-6 mt-0.5">
                              ⚠ No actual change was applied to the draft above — try rephrasing the request.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {/* This input kept getting a browser-extension icon rendered ON TOP of
                        typed text, mid-line — first seen with Grammarly/1Password (their
                        data-gramm / data-lpignore / data-1p-ignore attributes below), still
                        happening 2026-08-13 with a different extension's "···" overlay.
                        These per-extension opt-out attributes aren't 100% reliable (some
                        extensions attach via a MutationObserver that races a freshly-mounted
                        input like this one — only rendered at all once isChatOpen is true —
                        rather than respecting the attribute at mount), so this is now a
                        broader set covering the other common offenders (Dashlane, Bitwarden,
                        Microsoft Editor) rather than trusting any single one to be enough.
                        If a specific extension keeps winning the race regardless, the actual
                        fix is disabling it for this site — not something the app can force. */}
                    {/* Was a single-line <input> — a long message just scrolled
                        horizontally instead of wrapping, so the tail of what
                        you'd typed ended up visually hidden behind a browser
                        extension's icon overlay at the right edge (reported
                        2026-08-22). A wrapping textarea sidesteps that
                        entirely — nothing to scroll behind. Enter still
                        sends; Shift+Enter inserts a real line break. */}
                    <textarea value={chatInput[d.id] || ''}
                      onChange={e => setChatInput(prev => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isChatBusy) handleChatSend(d) } }}
                      placeholder="e.g. they prefer WhatsApp, not email — mention that instead"
                      rows={2}
                      className="input w-full text-sm resize-none" autoFocus
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                      name="daily-drafts-chat-input"
                      data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
                      data-lpignore="true" data-1p-ignore="true"
                      data-dashlane-ignore="true" data-bwignore="true" data-form-type="other"
                      data-ms-editor="false" />
                    <button type="button" onClick={() => handleChatSend(d)} disabled={isChatBusy} className="btn-secondary shrink-0 self-end">
                      {isChatBusy ? <Loader2 size={14} className="animate-spin" /> : 'Send'}
                    </button>
                  </div>
                  <div className="text-[11px] text-gray-400">
                    The AI only rewrites this email — it never edits the CRM record. Click <Bookmark size={10} className="inline" /> next to your own message to save it as a note instead.
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Sent ({sentDrafts.length})</h2>
        {sentDrafts.length === 0 && <div className="text-sm text-gray-400">Nothing sent yet.</div>}
        {sentDrafts.map(d => {
          const isReplyOpen = replyFormOpenId === d.id
          const isBusy = busyId === d.id
          return (
            <div key={d.id} className="card p-3 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 truncate">
                    {d.customerName} <span className="text-gray-400">— {d.productName || d.topicLabel}</span>
                    <SourceBadge source={d.source} />
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {ENGAGEMENT_BADGES.map(({ key, label, Icon }) => (
                      <span key={key} className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 ${
                        d.engagement?.[key]
                          ? ((key === 'bounced' || key === 'complained') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700')
                          : 'bg-gray-50 text-gray-300'
                      }`}>
                        <Icon size={11} /> {label}
                      </span>
                    ))}
                    {d.repliedAt && (
                      <span className="inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 bg-brand-50 text-brand-700">
                        <CheckCircle2 size={11} /> Replied{d.repliedChannel ? ` via ${d.repliedChannel}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                {!d.repliedAt && (
                  <button onClick={() => setReplyFormOpenId(isReplyOpen ? null : d.id)}
                    className="text-xs text-gray-500 hover:text-brand-600 shrink-0 whitespace-nowrap">
                    {isReplyOpen ? 'Cancel' : 'Log a reply'}
                  </button>
                )}
              </div>

              {isReplyOpen && (
                <div className="border border-ivory-dark rounded-lg p-3 bg-ivory-light space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    {REPLY_CHANNELS.map(ch => (
                      <button key={ch} type="button"
                        onClick={() => setReplyChannel(prev => ({ ...prev, [d.id]: ch }))}
                        className={`text-xs rounded px-2 py-1 border ${
                          (replyChannel[d.id] || REPLY_CHANNELS[0]) === ch
                            ? 'border-brand-600 bg-brand-50 text-brand-700'
                            : 'border-ivory-dark text-gray-500 hover:bg-white'
                        }`}>
                        {ch}
                      </button>
                    ))}
                  </div>
                  <textarea value={replyText[d.id] || ''}
                    onChange={e => setReplyText(prev => ({ ...prev, [d.id]: e.target.value }))}
                    placeholder="Paste their reply here (optional) — this and the channel get logged to their CRM record"
                    rows={2} className="input w-full text-sm"
                    autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                    data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
                    data-lpignore="true" data-1p-ignore="true" />
                  <button onClick={() => handleLogReply(d)} disabled={isBusy} className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
                    {isBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Log reply
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
