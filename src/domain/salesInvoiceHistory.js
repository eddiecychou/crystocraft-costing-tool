// Shared "Sales Invoice History" merge — one Sales Invoice number is either
// raised by the app (an order given an invoice number, per SalesInvoices.jsx's
// header comment: "An invoice is not a separate record here — it is an order
// that has been given an invoice number") or lives only in JES history. Used
// by three surfaces that all need the SAME de-duped, source-tagged list:
// SalesInvoices.jsx (all customers, admin), CustomerDetail.jsx (one customer,
// admin, adds a source badge), OrderHistoryPage.jsx (one customer, portal, no
// source badge — a customer doesn't need to know which system it lives in).

// An order already HAS an invoice when it carries an SI number — either in its
// own erp_si_no field, or (for JES-imported orders) in the doc-number field,
// where the SI sometimes landed instead of an SO/QU.
export const invoicedAlready = o => !!o.erp_si_no || /^SI/i.test(o.erp_so_no || '')

// `orders`: app orders (already filtered to invoicedAlready by the caller, or
// not — this re-filters defensively). `erpRows`: erp_sales_invoice rows
// (already scoped to one customer's erp_code by the caller). `code`: that
// customer's erp_code, shown as a plain column (admin) or unused (portal).
// Returns rows sorted newest first, each carrying `.src` ('app'|'jes'),
// `.no` (SI number), `.uc` (UC# — the number the team actually identifies an
// order by), `.date`, `.amount`, `.currency`, `.status`, `.raw` (jes rows only,
// for ErpDocModal / line lookups).
export function mergeSalesInvoiceHistory(orders, erpRows, code) {
  const app = (orders || []).filter(invoicedAlready).map(o => ({
    key: `app-${o.id}`, src: 'app', id: o.id,
    no: o.erp_si_no || o.erp_so_no, date: o.invoiced_at || o.order_date,
    uc: o.uc_no, customer: o.customer_name, code: code || null,
    currency: o.currency, amount: o.total_amount ?? o.subtotal, status: null,
  }))
  // The app's own invoices may also exist in the mirror once a sync runs;
  // showing both would double-count. The app row wins — it is the live one.
  const appNos = new Set(app.map(r => (r.no || '').trim().toUpperCase()))
  const jes = (erpRows || [])
    .filter(r => !appNos.has((r.code || '').trim().toUpperCase()))
    .map(r => ({
      key: `erp-${r.code}`, src: 'jes', id: null,
      no: (r.code || '').trim(), date: r.date,
      uc: (r.ref || '').trim(), customer: r.customer, code: r.customer_code || code || null,
      currency: r.currency, amount: r.amount, status: (r.status || '').trim().toUpperCase(),
      raw: r,
    }))
  return [...app, ...jes].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}
