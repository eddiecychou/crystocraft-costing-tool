import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

// Catalogue Collections — the "Shop by…" band. One `Collection` = one tile,
// populated three ways (spec §3): `filter` (maps to an existing category value),
// `manual` (hand-picked product ids), or `smart` (a render-time rule — v1: new_in).
//
// Storage: a SINGLE doc `settings/catalogue_band` keyed by catalogue. We keep
// tiles + layout here (rather than a top-level collection) so the existing
// `settings/*` security rule already permits storefront reads + admin writes —
// no new Firestore rule to deploy by hand. At 3–8 tiles × 2 catalogues this is
// tiny. Shape:
//   { range:     { show_section, max_tiles, columns, items: [Collection] },
//     corp_gift: { ... } }

const CATS = ['range', 'corp_gift']
const bandDoc = () => doc(db, 'settings', 'catalogue_band')
const newId = () => 'cc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Which existing product field a `filter` tile reads, per catalogue (spec §8).
export const FILTER_FIELD = { range: 'design_type', corp_gift: 'category' }

// Accent palette for templated tiles (v1). Light tint + same-family ink.
export const ACCENTS = [
  { key: 'teal',   label: 'Teal',    tile: '#E1F5EE', ink: '#0F6E56' },
  { key: 'blue',   label: 'Blue',    tile: '#E6F1FB', ink: '#185FA5' },
  { key: 'purple', label: 'Purple',  tile: '#EEEDFE', ink: '#534AB7' },
  { key: 'coral',  label: 'Coral',   tile: '#FAECE7', ink: '#993C1D' },
  { key: 'pink',   label: 'Pink',    tile: '#FBEAF0', ink: '#993556' },
  { key: 'amber',  label: 'Amber',   tile: '#FAEEDA', ink: '#854F0B' },
  { key: 'gray',   label: 'Neutral', tile: '#F1EFE8', ink: '#5F5E5A' },
]
export const accentOf = key => ACCENTS.find(a => a.key === key) || ACCENTS[0]
export const SMART_RULES = [{ key: 'new_in', label: 'New In (tagged new arrivals)' }]

const DEFAULT_SECTION = { show_section: true, max_tiles: 8, columns: 4, items: [] }
const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

export function normCollection(c) {
  const type = ['filter', 'manual', 'smart'].includes(c.type) ? c.type : 'filter'
  return {
    id: c.id || newId(),
    title: (c.title || '').trim(),
    subtitle: (c.subtitle || '').trim(),
    type,
    filter_value: type === 'filter' ? (c.filter_value || '').trim() : '',
    product_ids: type === 'manual' ? (Array.isArray(c.product_ids) ? c.product_ids.filter(Boolean) : []) : [],
    smart_rule: type === 'smart' ? (c.smart_rule || 'new_in') : '',
    accent: c.accent || 'teal',
    image_mode: c.image_mode === 'custom' ? 'custom' : 'template',
    custom_url: (c.custom_url || '').trim(),
    // Custom-tile label/overlay styling.
    title_color: c.title_color === 'black' ? 'black' : 'white',
    overlay_color: ['black', 'white', 'none'].includes(c.overlay_color) ? c.overlay_color : 'black',
    overlay_opacity: Math.max(0, Math.min(0.8, numOr(c.overlay_opacity, 0.55))),
    active: c.active !== false,
  }
}

const normSection = s => ({
  show_section: s?.show_section !== false,
  max_tiles: numOr(s?.max_tiles, 8),
  columns: numOr(s?.columns, 4),
  items: Array.isArray(s?.items) ? s.items.map(normCollection) : [],
})

function normBand(d) {
  return { range: normSection(d?.range), corp_gift: normSection(d?.corp_gift) }
}

// ── Hooks ────────────────────────────────────────────────────────────────────
export function useBand() {
  const [band, setBand] = useState(null)
  useEffect(() => onSnapshot(bandDoc(),
    s => setBand(normBand(s.exists() ? s.data() : {})),
    () => setBand(normBand({}))), [])
  return band
}

// Tiles for one catalogue (admin list). Returns [] while loading-safe.
export function useCollections(catalogue) {
  const band = useBand()
  return band ? band[catalogue].items : null
}

export function useBandSettings() {
  const band = useBand()
  return band || { range: DEFAULT_SECTION, corp_gift: DEFAULT_SECTION }
}

// ── Writes (read-modify-write the single doc) ────────────────────────────────
async function patchSection(catalogue, mutate) {
  const snap = await getDoc(bandDoc())
  const band = normBand(snap.exists() ? snap.data() : {})
  band[catalogue] = mutate({ ...band[catalogue] })
  await setDoc(bandDoc(), { [catalogue]: band[catalogue] }, { merge: true })
}

export async function saveCollection(catalogue, data) {
  const item = normCollection(data)
  await patchSection(catalogue, sec => {
    const items = [...sec.items]
    const i = items.findIndex(x => x.id === item.id)
    if (i >= 0) items[i] = item; else items.push(item)
    return { ...sec, items }
  })
  return item.id
}

export async function deleteCollection(catalogue, id) {
  await patchSection(catalogue, sec => ({ ...sec, items: sec.items.filter(x => x.id !== id) }))
}

export async function reorderCollections(catalogue, items) {
  await patchSection(catalogue, sec => ({ ...sec, items: items.map(normCollection) }))
}

export async function saveBandSettings(catalogue, patch) {
  await patchSection(catalogue, sec => ({ ...sec, ...patch }))
}

// ── Render helpers ───────────────────────────────────────────────────────────

// Active tiles trimmed so they fill whole rows: largest multiple of `columns`,
// capped at `max_tiles` (spec §3.2 ragged rule). Fewer than one row → none.
export function visibleCollections(items, cfg) {
  const active = (items || []).filter(c => c.active !== false)
  const cols = Math.max(1, cfg?.columns || 4)
  const capped = active.slice(0, Math.max(0, cfg?.max_tiles || 8))
  if (capped.length < cols) return []
  return capped.slice(0, capped.length - (capped.length % cols))
}

// Resolve the products a tile points at, from an already-loaded product list
// (each item carries id, the catalogue's filter field, is_new).
export function collectionProducts(c, products, catalogue) {
  if (!c) return []
  if (c.type === 'manual') {
    const byId = Object.fromEntries(products.map(p => [p.id, p]))
    return c.product_ids.map(id => byId[id]).filter(Boolean)
  }
  if (c.type === 'smart' && c.smart_rule === 'new_in') return products.filter(p => p.is_new)
  if (c.type === 'filter') {
    const field = FILTER_FIELD[catalogue]
    return products.filter(p => (p[field] || '') === c.filter_value)
  }
  return []
}

export { CATS }
