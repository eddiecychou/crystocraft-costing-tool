import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { RealCustomer } from "@/types/customer";
import { customerDisplayName } from "@/types/customer";

/**
 * Read-only access to costing-tool's own `customers` collection (same
 * Firebase project, no `pd_` prefix) — same pattern as realSuppliers.ts.
 * Product Design never writes here; customers are managed in the
 * costing-tool app itself.
 */
const COLLECTION = "customers";

export async function listRealCustomers(): Promise<RealCustomer[]> {
  // No orderBy — same reasoning as realSuppliers: a real customer doc isn't
  // guaranteed to carry every field a display name could fall back to, and
  // Firestore's orderBy silently drops docs missing the ordered field.
  const snap = await getDocs(collection(db, COLLECTION));
  const customers = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RealCustomer);
  return customers.sort((a, b) => customerDisplayName(a).localeCompare(customerDisplayName(b)));
}

export async function getRealCustomer(id: string): Promise<RealCustomer | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as RealCustomer) : null;
}

/**
 * Only the customers actually relevant here — ones with a brand profile
 * and/or at least one template — for the Customers/Brands browse page.
 * Same reasoning as listSuppliersWithProducts: the full costing-tool CRM
 * (hundreds of customers) is the right list for a picker where the point
 * is choosing one, but the wrong list to browse on its own.
 */
export async function listCustomersInUse(): Promise<RealCustomer[]> {
  const [brandSnap, templateSnap] = await Promise.all([
    getDocs(collection(db, "pd_customer_brands")),
    getDocs(collection(db, "pd_prompt_templates")),
  ]);
  const ids = new Set<string>();
  brandSnap.docs.forEach((d) => ids.add(d.id));
  templateSnap.docs.forEach((d) => ids.add((d.data() as { customerId: string }).customerId));

  const customers = await Promise.all(Array.from(ids).map((id) => getRealCustomer(id)));
  return customers
    .filter((c): c is RealCustomer => c !== null)
    .sort((a, b) => customerDisplayName(a).localeCompare(customerDisplayName(b)));
}
