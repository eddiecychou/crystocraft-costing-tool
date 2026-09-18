/**
 * Read-only view of a real customer record, owned by the costing-tool app
 * (Firestore `customers` collection, same Firebase project — its CRM/brand
 * data, not a Product Design copy). See costing-tool's `Customers.jsx` for
 * the full shape; this is just the subset used here.
 */
export interface RealCustomer {
  id: string;
  company_name?: string;
  contact_name?: string;
  country?: string;
  region?: string;
  crm_category?: string;
  erp_code?: string;
  tags?: string[];
}

export function customerDisplayName(c: RealCustomer): string {
  return c.company_name || c.contact_name || c.erp_code || "Unnamed customer";
}
