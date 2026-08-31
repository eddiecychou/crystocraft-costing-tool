import { createContext, useContext } from 'react'

// RBAC capability map — the SINGLE source of truth that both the sidebar
// (Layout.jsx) and the route guards (App.jsx's <Gate>) read, so a menu item
// and the URL it points at can never disagree about who may see a module.
//
// V8.12 introduces one new staff role, `production` (factory floor). It is
// NOT admin and NOT a customer — a distinct internal login that may touch
// only the supply/production side of the tool and must never see customers,
// finance, quotes, proposals or marketing. `admin` stays the super-user with
// access to everything; `customer` never reaches these modules at all (they
// get the Storefront, a different tree entirely). A future `sales` role would
// slot in here with its own allow-set; deliberately not built this cycle.
//
// A moduleKey is an ABSTRACT capability, not a route — several routes share
// one (e.g. /products, /products/:id, /products/:id/edit are all 'products').
// Tag each nav entry and each gated route with its key; access is decided
// here and nowhere else.

// Exactly the modules the factory needs (owner, V8.12): the catalogue of
// what's made, its bill-of-materials components, who supplies them, what's in
// stock, and a basic dashboard. Everything else is admin-only until a role
// is explicitly given the key. Purchase Orders and the Figurine range are
// deliberately NOT here — flip them in by adding the key if that changes.
const PRODUCTION_MODULES = new Set([
  'dashboard', 'products', 'components', 'suppliers', 'inventory',
  // Figurine Gifts — Crystocraft's own crystal-figurine catalogue, which the
  // factory makes. Full access incl. its wholesale prices and the markup/
  // costing page (owner's call, V8.12): production edits figurines like admin.
  'figurine',
  // Purchase Orders — supplier procurement. Added to production on the owner's
  // request (V8.12); it's supply-side cost data, not customer/sales data.
  'purchase_orders',
  // ERP Lookup, restricted to the Items + Inventory tabs — the page hides the
  // customer/invoice/sales-order tabs for production and the /api/erp edge
  // function rejects a production caller for any non-item entity. Added
  // V8.12 on the owner's request so factory staff can look up JES item/stock.
  'erp',
])

// V8.13 — the `sales` role: the customer-facing FRONT OFFICE, the mirror image
// of `production`'s supply/back office. Owner's call (2026-08-31, all four
// scope toggles): full CRM (customers + email/WhatsApp/Alibaba ingestion),
// quoting, marketing/Daily Drafts, catalogue + pricing (view AND edit, unlike
// production which is walled off from pricing), printed catalogues, plus
// fulfilment (Production/shipping) and finance (invoices, credit notes) and
// read-only Portal login visibility.
//
// HARD SAFETY LINE, enforced in firestore.rules NOT here: sales may READ the
// accounts list but may NEVER write users/{uid} role/status, nor create/approve
// portal invitations (that path is the admin-SDK function). So the Portal
// module is view-only for sales — no privilege escalation.
//
// Deliberately EXCLUDED (supply side + system internals, admin/production only):
// components, suppliers, purchase_orders, inventory, erp (ERP Lookup page),
// uc (UC Registry page), woo (WooCommerce Sync), settings.
const SALES_MODULES = new Set([
  'dashboard',
  'customers', 'quotes', 'marketing', 'catalogues',
  'products', 'figurine', 'pricing',
  'shipping', 'invoices', 'credit_notes',
  'portal', // view-only — mutations stay admin (see firestore.rules users/{uid})
])

// Is `moduleKey` visible to `role`? Admin sees all; production and sales each
// see only their allow-set; anyone else (unknown role) sees nothing — a closed
// default, the safe direction for an access check.
export function canAccess(role, moduleKey) {
  if (role === 'admin') return true
  if (role === 'production') return PRODUCTION_MODULES.has(moduleKey)
  if (role === 'sales') return SALES_MODULES.has(moduleKey)
  return false
}

// Role is provided once near the top of the tree (App.jsx) and read by any
// descendant that needs to gate itself, so role doesn't have to be threaded
// through every intermediate component. Defaults to 'admin' only so a
// provider-less render (shouldn't happen in the app) fails OPEN for staff
// tooling rather than white-screening — the Firestore rules are the real
// boundary regardless.
export const AccessContext = createContext('admin')
export const useRole = () => useContext(AccessContext)
export const useCan = () => {
  const role = useRole()
  return (moduleKey) => canAccess(role, moduleKey)
}
