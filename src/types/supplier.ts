/**
 * Read-only view of a real supplier record, owned by the costing-tool app
 * (Firestore `suppliers` collection, same Firebase project). Product Design
 * never creates or edits suppliers — it only picks from what's already
 * there. See costing-tool's `Suppliers.jsx` / `SupplierDetail.jsx` for the
 * full shape; this is just the subset used for display + picking here.
 */
export interface RealSupplier {
  id: string;
  name?: string;
  name_cn?: string;
  category?: string;
  city?: string;
  country?: string;
  contact_person?: string;
  erp_code?: string;
}

export function supplierDisplayName(s: RealSupplier): string {
  return s.name || s.name_cn || s.erp_code || "Unnamed supplier";
}
