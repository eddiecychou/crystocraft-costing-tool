import { createContext, useContext } from 'react'

// RBAC capability map — the SINGLE source of truth that both the sidebar
// (Layout.jsx) and the route guards (App.jsx's <Gate>) read.
//
// V8.14 — flat staff role. Every account is `admin`, `staff`, or `customer`.
// `admin` sees everything; `customer` gets the Storefront (a different tree).
// A `staff` account's access is EXACTLY the module keys listed in its
// `users/{uid}.modules[]` array, toggled by the admin in AccountEdit.jsx.
// The old fixed `production` / `sales` roles are fully retired — both live
// accounts were migrated to `staff` + modules[] on 2026-09-02 and the shim
// removed.
//
// A moduleKey is an ABSTRACT capability, not a route — several routes share
// one (e.g. /products, /products/:id, /products/:id/edit are all 'products').
// Tag each nav entry and each gated route with its key; access is decided
// here and nowhere else. The Firestore rules mirror these keys with a
// `can('<key>')` check — see RBAC-FLEX-PLAN.md §4.

// The full catalogue of module keys, grouped for the AccountEdit checklist.
// `sensitive: true` = grants sight of costs / margins / all-customer data /
// money / trade secrets — the admin should think before ticking.
export const MODULE_GROUPS = [
  { group: 'Catalogue', keys: [
    { key: 'products',    label: 'Corp Gifts' },
    { key: 'figurine',    label: 'Figurine Gifts (catalogue + costing)' },
    { key: 'swatch',      label: 'Swatch Library' },
    { key: 'catalogues',  label: 'Printed Catalogues' },
    { key: 'pricing',     label: 'Pricing — corp-gift tier editor', sensitive: true },
  ] },
  { group: 'Front office', keys: [
    { key: 'customers',   label: 'Customers & CRM', sensitive: true },
    { key: 'quotes',      label: 'Quotes' },
    { key: 'marketing',   label: 'Marketing' },
    { key: 'portal',      label: 'Portal — account list (view only)' },
  ] },
  { group: 'Fulfilment & finance', keys: [
    { key: 'shipping',     label: 'Production / Shipping' },
    { key: 'invoices',     label: 'Sales Invoices', sensitive: true },
    { key: 'credit_notes', label: 'Credit Notes', sensitive: true },
    { key: 'uc',           label: 'UC Registry', sensitive: true },
  ] },
  { group: 'Supply', keys: [
    { key: 'supply',      label: 'Supply — Components, Suppliers, Purchase Orders, Inventory' },
  ] },
  { group: 'Ecommerce', keys: [
    { key: 'woo',         label: 'WooCommerce + SEO control plane' },
  ] },
  { group: 'System', keys: [
    { key: 'dashboard',   label: 'Dashboard' },
    { key: 'erp',         label: 'ERP Lookup', sensitive: true },
    { key: 'settings',    label: 'Settings', sensitive: true },
  ] },
]
export const ALL_MODULE_KEYS = MODULE_GROUPS.flatMap(g => g.keys.map(k => k.key))
export const SENSITIVE_MODULE_KEYS = MODULE_GROUPS.flatMap(g => g.keys.filter(k => k.sensitive).map(k => k.key))

// The effective module list for a profile. Admin doesn't need it (canAccess
// short-circuits). Returns [] for anyone who shouldn't be in the app.
export function resolveModules(profile) {
  if (!profile) return []
  if (profile.role === 'staff') return Array.isArray(profile.modules) ? profile.modules : []
  return []
}

// Is `moduleKey` available to this caller? Admin: everything. Otherwise: only
// if the key is in their resolved module list. Unknown role → nothing (a
// closed default — the safe direction).
export function canAccess(role, moduleKey, modules = []) {
  if (role === 'admin') return true
  return Array.isArray(modules) && modules.includes(moduleKey)
}

// Provided once near the top of the tree (App.jsx) as { role, modules } and
// read by any descendant that needs to gate itself. Defaults to admin/all so
// a provider-less render fails OPEN for staff tooling rather than
// white-screening — the Firestore rules are the real boundary regardless.
export const AccessContext = createContext({ role: 'admin', modules: [] })
export const useAccess = () => useContext(AccessContext)
export const useRole = () => useAccess().role
export const useCan = () => {
  const { role, modules } = useAccess()
  return (moduleKey) => canAccess(role, moduleKey, modules)
}
