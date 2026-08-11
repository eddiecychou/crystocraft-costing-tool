import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import {
  Send, Loader2, SkipForward, Sparkles, Trash2, X, Link2,
  MessageCircle, CheckCircle2, Eye, MousePointerClick, AlertTriangle, Bookmark, BellOff,
} from 'lucide-react'
import { db, authedUser } from '../firebase'
import { loadCustomers, primaryContact } from '../domain/customer'
import { normalizeContact, markContactOutreach, blockContactOutreach } from '../domain/marketingContact'
import {
  listPendingDrafts, listDraftsForProduct, listSentDrafts, listRecentDecisions,
  createDrafts, markDraftSent, markDraftReplied, skipDraft, deleteAllPending,
} from '../domain/outreachDrafts'
import { generateDrafts, sendPersonalEmail, searchBlogPosts, discussDraft } from '../outreachApi'
import { isPublicVisible } from '../constants'
import { loadBlogProducts, loadBlogImages } from '../productSource'

// Daily Drafts re-engagement engine (V7.23) — pick a product, generate 10-20
// AI-drafted personal emails against the eligible customer+contact pool,
// review (optionally discussing/correcting with AI) and send one at a time.
// See PROJECT-PLAN.md V7.23 and the plan this shipped from for the design
// reasoning throughout this file — in particular: AI fit-scoring instead of
// a hand-built category map, no persistent "recommended pick" flag (product
// is chosen manually each run), trade-audience-only marketing_contacts, and
// why "reply tracking" here is a manual toggle, not detection (Resend can't
// see inbound replies — see resend-webhook.js).

const COOLDOWN_DAYS = 14        // don't re-suggest someone within this many days of their last outreach
const PRODUCT_COOLDOWN_DAYS = 21 // don't re-suggest the SAME product to someone already sent it recently
const MAX_CANDIDATES = 60        // sent to fit-scoring; protects DeepSeek rate limits and function run time
const MAX_HISTORY_DECISIONS = 60 // how many recent sent/skipped drafts feed the historicalHints summary

const daysAgo = (ts) => {
  if (!ts) return Infinity
  const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime()
  return (Date.now() - ms) / 86400000
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
  const contact = primaryContact(c.contacts)
  const email = contact?.email?.trim().toLowerCase()
  if (!email) return null
  return {
    source: 'customer', id: c.id, name: c.company_name, email,
    crm_category: c.crm_category, crm_status: c.crm_status,
    notes: c.notes, erp_code: c.erp_code, country: c.country,
    lastOutreachAt: c.lastOutreachAt, blockOutreachUntil: c.blockOutreachUntil,
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
    lastOutreachAt: c.lastOutreachAt, blockOutreachUntil: c.blockOutreachUntil,
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
  pool.sort((a, b) => daysAgo(b.lastOutreachAt) - daysAgo(a.lastOutreachAt)) // never-contacted (Infinity) sorts first
  return pool.slice(0, MAX_CANDIDATES).map(e => ({
    id: e.id, name: e.name, email: e.email, source: e.source,
    crm_category: e.crm_category, crm_status: e.crm_status, notes: e.notes, erp_code: e.erp_code,
    country: e.country,
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

// Writes one entry to the customer's CRM Interaction Log
// (customers/{id}/enquiries — see CustomerDetail.jsx/EnquiryForm.jsx, which
// own the UI for this same subcollection; no dedicated domain module exists
// for it anywhere in the app, everything writes to it inline like this).
// Only customers HAVE this log — marketing_contacts don't (they're not a
// full CRM record yet), so a contact-sourced draft logs to app_notes
// instead (same appendNote path the "Save as note" chat action already
// uses), not this function.
//
// `status: 'Open'` on every entry (not a dedicated "sent"/"replied" status —
// the enquiry schema doesn't have one) mirrors how a human logging this by
// hand would leave it for themselves to follow up on, not mark resolved.
async function logInteraction(customerId, { description, channel }) {
  await addDoc(collection(db, 'customers', customerId, 'enquiries'), {
    date: Timestamp.now(),
    contact_id: null,
    description,
    product_interest: [],
    channel: channel || 'Email',
    status: 'Open',
    follow_up_date: null,
    outcome_notes: '',
    linked_quote_ids: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

async function appendNote(collectionName, id, field, text) {
  const snap = await getDoc(doc(db, collectionName, id))
  const existing = snap.exists() ? (snap.data()[field] || '') : ''
  await updateDoc(doc(db, collectionName, id), {
    [field]: [existing, text].filter(Boolean).join('\n'), updatedAt: serverTimestamp(),
  })
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
]

export default function DailyDrafts() {
  const [products, setProducts] = useState([]) // merged corporate + Crystocraft Range, each tagged .source
  const [selectedProduct, setSelectedProduct] = useState(null) // the normalized product object, not just an id — .source decides which collection/shape everything downstream uses
  const [productQuery, setProductQuery] = useState('')
  const [drafts, setDrafts] = useState([])
  const [sentDrafts, setSentDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [edits, setEdits] = useState({}) // draftId -> { subject, body }

  // Optional per-generate-run attachments — same for every draft in the
  // batch (same product == same photos/link make sense across the batch).
  const [productImages, setProductImages] = useState([])
  const [selectedImageUrls, setSelectedImageUrls] = useState([])
  const [blogQuery, setBlogQuery] = useState('')
  const [blogResults, setBlogResults] = useState([])
  const [blogSearching, setBlogSearching] = useState(false)
  const [blogLink, setBlogLink] = useState(null) // { title, url }
  const [targetingNote, setTargetingNote] = useState('') // e.g. "Crystocraft distributors in Europe" — folded into the fit-score prompt as a strong steer, see generate-outreach-drafts.js

  // Per-draft "discuss with AI" chat — working scratch, not persisted to
  // Firestore (see discuss-outreach-draft.js's header comment).
  const [chatOpenId, setChatOpenId] = useState(null)
  const [chatHistory, setChatHistory] = useState({}) // draftId -> [{role, content}]
  const [chatInput, setChatInput] = useState({}) // draftId -> string
  const [chatBusy, setChatBusy] = useState(null)

  // Per-draft attachment editing — separate from the generate-time picker
  // above (which just sets the batch default). Each draft's photos/link can
  // be added to or removed from independently on its own card.
  const [productImagesCache, setProductImagesCache] = useState({}) // productId -> images[]
  const [photoPickerOpenId, setPhotoPickerOpenId] = useState(null)
  const [blogPickerOpenId, setBlogPickerOpenId] = useState(null)
  const [draftBlogQuery, setDraftBlogQuery] = useState({}) // draftId -> string
  const [draftBlogResults, setDraftBlogResults] = useState({}) // draftId -> posts[]
  const [draftBlogSearching, setDraftBlogSearching] = useState(null)

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

  // Selected product's own image gallery, filtered to visibility:'public'.
  // loadBlogImages() already knows how to resolve either shape (corporate =
  // a Firestore subcollection query; range = the inline gallery array
  // already on the normalized object) — range images carry no visibility
  // field at all, and isPublicVisible treats a missing field as public, so
  // the same filter still applies uniformly. Reset selections when the
  // product changes so a leftover photo from a previous product can't ride
  // along silently.
  useEffect(() => {
    setSelectedImageUrls([])
    if (!selectedProduct) { setProductImages([]); return }
    loadBlogImages(selectedProduct.source, selectedProduct).then(imgs => {
      setProductImages(imgs.filter(isPublicVisible))
    })
  }, [selectedProduct])

  function toggleImage(url) {
    setSelectedImageUrls(prev =>
      prev.includes(url) ? prev.filter(u => u !== url) : prev.length < 2 ? [...prev, url] : prev
    )
  }

  // Lazily loads and caches a product's public images, keyed by
  // "source:productId" (not draftId — every draft in a batch shares the same
  // product, no need to fetch the same gallery once per draft; keyed by
  // source too since a corporate-products id and a range_products id are
  // independent namespaces). Range images resolve from the already-loaded
  // `products` list (their gallery is an inline array, not a subcollection —
  // see loadBlogImages) rather than a fresh Firestore read.
  async function ensureProductImages(pid, source) {
    const key = `${source || 'corporate'}:${pid}`
    if (!pid || productImagesCache[key]) return
    const product = products.find(p => p.id === pid && p.source === (source || 'corporate')) || { id: pid }
    const imgs = await loadBlogImages(source || 'corporate', product)
    setProductImagesCache(prev => ({ ...prev, [key]: imgs.filter(isPublicVisible) }))
  }

  function toggleDraftImage(d, url) {
    const cur = fieldsFor(d).imageUrls || []
    const next = cur.includes(url) ? cur.filter(u => u !== url) : (cur.length < 2 ? [...cur, url] : cur)
    setField(d.id, 'imageUrls', next)
  }
  function removeDraftImage(d, url) {
    setField(d.id, 'imageUrls', (fieldsFor(d).imageUrls || []).filter(u => u !== url))
  }
  function removeDraftBlogLink(d) {
    setField(d.id, 'blogLink', null)
  }

  async function handleDraftBlogSearch(d) {
    setDraftBlogSearching(d.id)
    try {
      const posts = await searchBlogPosts(draftBlogQuery[d.id] || '')
      setDraftBlogResults(prev => ({ ...prev, [d.id]: posts }))
    } catch (e) {
      setError(e.message || 'Blog search failed.')
    } finally {
      setDraftBlogSearching(null)
    }
  }
  function pickDraftBlogLink(d, post) {
    setField(d.id, 'blogLink', { title: post.title, url: post.link })
    setDraftBlogResults(prev => ({ ...prev, [d.id]: [] }))
    setBlogPickerOpenId(null)
  }

  async function handleBlogSearch() {
    setBlogSearching(true); setError('')
    try {
      setBlogResults(await searchBlogPosts(blogQuery))
    } catch (e) {
      setError(e.message || 'Blog search failed.')
    } finally {
      setBlogSearching(false)
    }
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

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) return products.slice(0, 50)
    return products.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 50)
  }, [products, productQuery])

  async function handleGenerate() {
    const product = selectedProduct
    if (!product) { setError('Pick a product first.'); return }
    setGenerating(true); setError('')
    try {
      const [customers, contactDocs, existingDrafts, recentDecisions] = await Promise.all([
        loadCustomers(),
        getDocs(collection(db, 'marketing_contacts')),
        listDraftsForProduct(product.id),
        listRecentDecisions(MAX_HISTORY_DECISIONS),
      ])
      const contacts = contactDocs.docs.map(d => normalizeContact(d.id, d.data()))

      // Exclude anyone already sitting in pending_review for this product
      // outright (regenerating must never duplicate an unreviewed draft), and
      // anyone sent this product within the cooldown window. Excluded by both
      // id and email — see eligibleCandidates' comment on duplicate records.
      const alreadyDrafted = existingDrafts.filter(d =>
        d.status === 'pending_review' || (d.status === 'sent' && daysAgo(d.sentAt) < PRODUCT_COOLDOWN_DAYS)
      )
      const excludedIds = new Set(alreadyDrafted.map(d => d.customerId))
      const excludedEmails = new Set(alreadyDrafted.map(d => (d.customerEmail || '').trim().toLowerCase()).filter(Boolean))

      const entities = [...customers.map(customerToEntity), ...contacts.map(contactToEntity)]
      const candidates = eligibleCandidates(entities, excludedIds, excludedEmails)
      if (!candidates.length) { setError('No eligible customers/contacts right now (cooldowns/blocks cleared the whole pool).'); return }

      const historicalHints = summarizeHistory(recentDecisions)
      const generated = await generateDrafts(
        { id: product.id, name: product.name, description: product.description, category: product.category },
        candidates,
        historicalHints,
        targetingNote.trim(),
      )
      if (!generated.length) { setError('DeepSeek returned no usable drafts — try again.'); return }
      await createDrafts(product, generated, { imageUrls: selectedImageUrls, blogLink })
      reload()
    } catch (e) {
      setError(e.message || 'Could not generate drafts.')
    } finally {
      setGenerating(false)
    }
  }

  // imageUrls/blogLink start from whatever generate-time attached (see
  // handleGenerate), but are editable per draft below — add/remove
  // independent of what the batch default was.
  function fieldsFor(d) {
    return edits[d.id] || { subject: d.draftSubject, body: d.draftBody, imageUrls: d.imageUrls || [], blogLink: d.blogLink || null }
  }
  function setField(draftId, key, value) {
    setEdits(prev => ({
      ...prev,
      [draftId]: { ...fieldsFor(drafts.find(d => d.id === draftId) || {}), ...prev[draftId], [key]: value },
    }))
  }

  async function handleSend(d) {
    const { subject, body, imageUrls, blogLink } = fieldsFor(d)
    setBusyId(d.id); setError('')
    try {
      await sendPersonalEmail({ customerEmail: d.customerEmail, subject, body, draftId: d.id, imageUrls, blogLink })
      const user = await authedUser()
      await markDraftSent(d.id, user?.uid)
      if (d.source === 'contact') {
        await markContactOutreach(d.customerId)
      } else {
        await updateDoc(doc(db, 'customers', d.customerId), { lastOutreachAt: serverTimestamp() })
        // Only customers/ has a CRM Interaction Log (customers/{id}/enquiries)
        // — marketing_contacts isn't a full CRM record yet, nothing to log
        // this against there.
        await logInteraction(d.customerId, {
          description: `Sent Daily Drafts outreach email — ${subject}\n\n${body}`,
          channel: 'Email',
        })
      }
      setDrafts(prev => prev.filter(x => x.id !== d.id))
      reloadSent()
    } catch (e) {
      setError(e.message || 'Send failed.')
    } finally {
      setBusyId(null)
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
  // that actually matters — onto the customer's real CRM Interaction Log,
  // the same one CustomerDetail.jsx's "+ Log Interaction" writes to, so it
  // shows up there regardless of which channel it came in on.
  async function handleLogReply(d) {
    const channel = replyChannel[d.id] || REPLY_CHANNELS[0]
    const text = (replyText[d.id] || '').trim()
    setBusyId(d.id); setError('')
    try {
      await markDraftReplied(d.id, { channel, replyText: text })
      const description = `Replied via ${channel}${text ? `: ${text}` : ''}`
      if (d.source === 'contact') await appendNote('marketing_contacts', d.customerId, 'app_notes', description)
      else await logInteraction(d.customerId, { description, channel })
      setSentDrafts(prev => prev.map(x => x.id === d.id ? { ...x, repliedAt: new Date(), repliedChannel: channel, replyText: text } : x))
      setReplyFormOpenId(null)
      setReplyText(prev => ({ ...prev, [d.id]: '' }))
    } catch (e) {
      setError(e.message || 'Could not log that reply.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleChatSend(d) {
    const message = (chatInput[d.id] || '').trim()
    if (!message) return
    const history = chatHistory[d.id] || []
    const fields = fieldsFor(d)
    setChatBusy(d.id); setError('')
    try {
      const result = await discussDraft({
        productContext: d.productName,
        customerContext: d.customerContext,
        draftSubject: fields.subject,
        draftBody: fields.body,
        history,
        message,
      })
      setChatHistory(prev => ({
        ...prev,
        [d.id]: [...history, { role: 'user', content: message }, { role: 'assistant', content: result.reply }],
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

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-8">
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Generate today's drafts</h2>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Product to feature</label>
          <input value={productQuery} onChange={e => { setProductQuery(e.target.value); setSelectedProduct(null) }}
            placeholder="Search Corporate Gifts or Crystocraft Range…" className="input w-full md:w-96 mb-1" />
          {productQuery && !selectedProduct && (
            <div className="border border-ivory-dark rounded max-h-48 overflow-y-auto w-full md:w-96">
              {filteredProducts.map(p => (
                <button key={`${p.source}-${p.id}`} type="button"
                  onClick={() => { setSelectedProduct(p); setProductQuery(p.name) }}
                  className="w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 text-sm hover:bg-ivory-light">
                  <span className="truncate">{p.name}</span>
                  <span className={`text-[10px] uppercase tracking-wide rounded px-1 py-0.5 shrink-0 ${
                    p.source === 'range' ? 'bg-brand-50 text-brand-700' : 'bg-blue-50 text-blue-700'
                  }`}>
                    {p.source === 'range' ? 'Range' : 'Corporate'}
                  </span>
                </button>
              ))}
              {!filteredProducts.length && <div className="px-3 py-1.5 text-sm text-gray-400">No matches.</div>}
            </div>
          )}
        </div>

        {selectedProduct && productImages.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Include photos (up to 2, optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {productImages.map(img => {
                const picked = selectedImageUrls.includes(img.file_url)
                return (
                  // Range gallery images have no .id (they're a plain array on the
                  // doc, not Firestore subcollection docs) — file_url is unique
                  // enough within one product's gallery either way.
                  <button key={img.id || img.file_url} type="button" onClick={() => toggleImage(img.file_url)}
                    className={`relative w-16 h-16 rounded overflow-hidden border-2 ${picked ? 'border-brand-600' : 'border-transparent'}`}>
                    <img src={img.file_url} alt="" className="w-full h-full object-cover" />
                    {picked && <div className="absolute inset-0 bg-brand-600/20" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Attach a blog link (optional)</label>
          {blogLink ? (
            <div className="inline-flex items-center gap-1.5 text-sm bg-ivory-light rounded px-2 py-1">
              <Link2 size={12} className="text-gray-400" />
              <span className="truncate max-w-xs">{blogLink.title}</span>
              <button type="button" onClick={() => setBlogLink(null)} className="text-gray-400 hover:text-red-600">
                <X size={12} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input value={blogQuery} onChange={e => setBlogQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBlogSearch()}
                  placeholder="Search crystocraft.com blog…" className="input w-full md:w-80" />
                <button type="button" onClick={handleBlogSearch} disabled={blogSearching} className="btn-secondary shrink-0">
                  {blogSearching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
                </button>
              </div>
              {blogResults.length > 0 && (
                <div className="border border-ivory-dark rounded max-h-40 overflow-y-auto w-full md:w-96 mt-1">
                  {blogResults.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => { setBlogLink({ title: p.title, url: p.link }); setBlogResults([]) }}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-ivory-light truncate">
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Who do you want to reach today? (optional)</label>
          <input value={targetingNote} onChange={e => setTargetingNote(e.target.value)}
            placeholder='e.g. "Hong Kong corporate gift customers" or "Crystocraft distributors in Europe"'
            className="input w-full md:w-96" />
          <div className="text-[11px] text-gray-400 mt-1">Narrows today's picks — a strong steer, not just a hint.</div>
        </div>

        <button onClick={handleGenerate} disabled={generating || !selectedProduct} className="btn-primary inline-flex items-center gap-1.5">
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generating ? 'Generating…' : 'Generate Drafts'}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Pending review ({drafts.length})</h2>
          {drafts.length > 0 && (
            <button onClick={handleClearAllPending} className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1">
              <Trash2 size={12} /> Clear all pending
            </button>
          )}
        </div>
        {drafts.length === 0 && <div className="text-sm text-gray-400">No drafts waiting — generate some above.</div>}
        {drafts.map(d => {
          const fields = fieldsFor(d)
          const isBusy = busyId === d.id
          const isChatOpen = chatOpenId === d.id
          const isChatBusy = chatBusy === d.id
          const history = chatHistory[d.id] || []
          return (
            <div key={d.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {d.customerName} <span className="text-gray-400 font-normal">— {d.customerEmail}</span>
                    <SourceBadge source={d.source} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {d.productName} · fit {Math.round((d.fitScore || 0) * 100)}%
                    {d.fitReason && <span className="text-gray-400"> — {d.fitReason}</span>}
                  </div>
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
                {(fields.imageUrls || []).length < 2 && (
                  <button type="button"
                    onClick={() => { setPhotoPickerOpenId(photoPickerOpenId === d.id ? null : d.id); ensureProductImages(d.productId, d.productSource) }}
                    className="text-xs text-gray-400 hover:text-brand-600 border border-dashed border-ivory-dark rounded px-2 py-1.5">
                    + Photo
                  </button>
                )}
                {fields.blogLink ? (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-ivory-light rounded px-2 py-1">
                    <Link2 size={11} /> {fields.blogLink.title}
                    <button type="button" onClick={() => removeDraftBlogLink(d)} className="text-gray-400 hover:text-red-600">
                      <X size={11} />
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setBlogPickerOpenId(blogPickerOpenId === d.id ? null : d.id)}
                    className="text-xs text-gray-400 hover:text-brand-600 border border-dashed border-ivory-dark rounded px-2 py-1.5">
                    + Link
                  </button>
                )}
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

              {blogPickerOpenId === d.id && (
                <div className="border border-ivory-dark rounded p-2 space-y-1">
                  <div className="flex gap-2">
                    <input value={draftBlogQuery[d.id] || ''}
                      onChange={e => setDraftBlogQuery(prev => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleDraftBlogSearch(d)}
                      placeholder="Search crystocraft.com blog…" className="input w-full text-sm" />
                    <button type="button" onClick={() => handleDraftBlogSearch(d)} disabled={draftBlogSearching === d.id} className="btn-secondary shrink-0">
                      {draftBlogSearching === d.id ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
                    </button>
                  </div>
                  {(draftBlogResults[d.id] || []).map(p => (
                    <button key={p.id} type="button" onClick={() => pickDraftBlogLink(d, p)}
                      className="block w-full text-left px-2 py-1 text-sm hover:bg-ivory-light truncate rounded">
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
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
                <button onClick={() => setChatOpenId(isChatOpen ? null : d.id)}
                  className="text-xs text-gray-500 hover:text-brand-600 inline-flex items-center gap-1 ml-auto">
                  <MessageCircle size={13} /> {isChatOpen ? 'Close' : 'Discuss with AI'}
                </button>
              </div>

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
                              <button type="button" onClick={() => handleSaveNote(d, h.content)}
                                title="Save this as a note on the customer record"
                                className="text-gray-400 hover:text-brand-600 shrink-0">
                                <Bookmark size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {/* data-gramm/data-lpignore/data-1p-ignore: this input kept getting a
                        browser-extension icon (Grammarly/password-manager) rendered on top of
                        typed text, mid-line — these are the standard attributes to opt an
                        input out of that injected UI. */}
                    <input value={chatInput[d.id] || ''}
                      onChange={e => setChatInput(prev => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && !isChatBusy && handleChatSend(d)}
                      placeholder="e.g. they prefer WhatsApp, not email — mention that instead"
                      className="input w-full text-sm" autoFocus
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                      data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
                      data-lpignore="true" data-1p-ignore="true" />
                    <button type="button" onClick={() => handleChatSend(d)} disabled={isChatBusy} className="btn-secondary shrink-0">
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
                    {d.customerName} <span className="text-gray-400">— {d.productName}</span>
                    <SourceBadge source={d.source} />
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {ENGAGEMENT_BADGES.map(({ key, label, Icon }) => (
                      <span key={key} className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 ${
                        d.engagement?.[key] ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-300'
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
