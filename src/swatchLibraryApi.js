// Client for the Crystal Fabric Studio swatch library — see
// Crystal_Fabric_Studio_Spec.md §5a/§5b. Registry data (photos, colours,
// backfilms) is proxied read-only from the render service via
// /api/swatch-library, now open to admins AND approved portal customers
// (§5b); curated notes (legacy_swarovski_refs) are a small Firestore
// collection this app owns directly, customer-readable / admin-writable.
// recommended_use_cases dropped 2026-08-11 (owner: too fiddly to enter).
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { authedUser } from './firebase'
import { notifyEmail } from './notify'

async function authedGet(path) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    let data = {}
    try { data = await res.json() } catch { /* non-JSON error body, e.g. image proxy */ }
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return res
}

// { crystal: { [name]: { rgb, slots: { fabric: { [backfilm]: {file,pitch,url} }, rock: {...} } } } }
export async function fetchSwatchRegistry() {
  const res = await authedGet('/api/swatch-library?action=list')
  return (await res.json()).crystal || {}
}

// Swatch photos are admin-gated on the render service — this app can't just
// point an <img> at the Fly URL, it has to fetch through the authed proxy
// and turn the bytes into an object URL. Caller is responsible for
// revoking it (URL.revokeObjectURL) when done.
export async function fetchSwatchImageUrl(filename) {
  const res = await authedGet(`/api/swatch-library?action=image&file=${encodeURIComponent(filename)}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

const NOTES_COL = 'crystal_swatch_notes'

const normNotes = (id, x) => ({
  id,
  legacy_swarovski_refs: Array.isArray(x?.legacy_swarovski_refs) ? x.legacy_swarovski_refs : [],
})

export async function loadSwatchNotes(colorName) {
  try {
    const snap = await getDoc(doc(db, NOTES_COL, colorName))
    return normNotes(colorName, snap.exists() ? snap.data() : null)
  } catch {
    return normNotes(colorName, null)
  }
}

export async function saveSwatchNotes(colorName, { legacy_swarovski_refs }) {
  await setDoc(doc(db, NOTES_COL, colorName), {
    legacy_swarovski_refs: Array.isArray(legacy_swarovski_refs) ? legacy_swarovski_refs : [],
    updated_at: serverTimestamp(),
  }, { merge: true })
}

// Phase 2b sample-request CTA — the actual conversion event per
// Crystal_Fabric_Studio_Spec.md §4 ("physical samples are the actual
// conversion event, not a rendered PNG"), not a price band. Reuses the
// existing `enquiries` collection (same lead-capture shape the wholesale
// enquiry cart already writes, same admin Enquiries.jsx inbox picks it up
// from) rather than a parallel lead table — a single `type: 'swatch_sample'`
// item distinguishes it in the admin list.
export async function requestSwatchSample(profile, { colorName, style, backfilm, note }) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const payload = {
    uid: user.uid,
    company_name: profile?.company_name || '',
    contact_name: profile?.contact_name || '',
    email: profile?.email || user.email || '',
    base_currency: profile?.base_currency || '',
    items: [{
      type: 'swatch_sample', name: colorName, color_name: colorName,
      finish: style === 'fabric' ? 'Crystal Fabric' : 'Fine Rock / Rock',
      note: [backfilm ? `${backfilm} backfilm` : '', note].filter(Boolean).join(' — '),
      qty: 1, line_total: null,
    }],
    message: note || '',
    status: 'new',
    createdAt: serverTimestamp(),
  }
  await addDoc(collection(db, 'enquiries'), payload)
  notifyEmail('enquiry', {
    company_name: payload.company_name, contact_name: payload.contact_name, email: payload.email,
    currency: payload.base_currency, estimated_total: null,
    items: [{ name: `Swatch sample — ${colorName}`, qty: 1 }],
  })
}
