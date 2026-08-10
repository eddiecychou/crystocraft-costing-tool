import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

// Front page "Featured Products" — hand-picked showcase cards on the
// customer portal homepage (/shop), each a specific product AND a specific
// one of its own gallery photos, not just whatever the product's default
// hero image happens to be (owner, 2026-08-11: "I can manually enter the 8
// products... and select the hero image for each to display").
//
// Storage: settings/front_page — same existing-rule-reuse reasoning as
// catalogueCollections.js's settings/catalogue_band (storefront read + admin
// write already permitted by the settings/{docId} rule; no new Firestore
// rule to deploy for this).
// Shape: { items: [{ id, product_id, product_type: 'range'|'corp_gift', image_url }] }

const cfgDoc = () => doc(db, 'settings', 'front_page')
const newId = () => 'fp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function normItem(it) {
  return {
    id: it.id || newId(),
    product_id: String(it.product_id || ''),
    product_type: it.product_type === 'corp_gift' ? 'corp_gift' : 'range',
    image_url: String(it.image_url || ''),
  }
}

function normConfig(d) {
  return {
    items: Array.isArray(d?.items) ? d.items.map(normItem).filter(x => x.product_id && x.image_url) : [],
  }
}

// null while loading.
export function useFrontPageFeatured() {
  const [cfg, setCfg] = useState(null)
  useEffect(() => onSnapshot(cfgDoc(),
    s => setCfg(normConfig(s.exists() ? s.data() : {})),
    () => setCfg(normConfig({}))), [])
  return cfg
}

export async function saveFrontPageFeatured(items) {
  await setDoc(cfgDoc(), { items: items.map(normItem) }, { merge: true })
}

export async function getFrontPageFeaturedOnce() {
  const snap = await getDoc(cfgDoc())
  return normConfig(snap.exists() ? snap.data() : {})
}
