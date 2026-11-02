// Fictional human accounts only. Expected decisions are explicit, not computed
// from production permission helpers. Reserved service identities are separate.
export const accessCases = [
  { name: 'admin without modules', profile: { role: 'admin' }, marketing: true, customers: true },
  { name: 'admin with unrelated modules', profile: { role: 'admin', modules: ['supply'] }, marketing: true, customers: true },
  { name: 'staff marketing only', profile: { role: 'staff', modules: ['marketing'] }, marketing: true, customers: false },
  { name: 'staff customers only', profile: { role: 'staff', modules: ['customers'] }, marketing: false, customers: true },
  { name: 'staff both modules', profile: { role: 'staff', modules: ['customers', 'marketing'] }, marketing: true, customers: true },
  { name: 'staff empty modules', profile: { role: 'staff', modules: [] }, marketing: false, customers: false },
  { name: 'staff missing modules', profile: { role: 'staff' }, marketing: false, customers: false },
  { name: 'staff non-list modules', profile: { role: 'staff', modules: 'marketing' }, marketing: false, customers: false },
  { name: 'staff null modules', profile: { role: 'staff', modules: null }, marketing: false, customers: false },
  { name: 'customer with forged modules', profile: { role: 'customer', status: 'approved', modules: ['marketing', 'customers'] }, marketing: false, customers: false },
  { name: 'legacy sales role', profile: { role: 'sales', modules: ['marketing', 'customers'] }, marketing: false, customers: false },
  { name: 'unknown role', profile: { role: 'unknown', modules: ['marketing', 'customers'] }, marketing: false, customers: false },
  { name: 'missing role', profile: { modules: ['marketing', 'customers'] }, marketing: false, customers: false },
  { name: 'missing user document', profile: null, marketing: false, customers: false },
]
