import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listProducts } from "@/lib/firestore/products";
import type { RealSupplier } from "@/types/supplier";
import { supplierDisplayName } from "@/types/supplier";

/**
 * Read-only access to costing-tool's own `suppliers` collection (same
 * Firebase project, no `pd_` prefix — this is the real, live supplier
 * roster). Product Design never writes here; suppliers are managed in the
 * costing-tool app itself. See docs/reference/FIRESTORE-COLLECTIONS.md in
 * that repo.
 */
const COLLECTION = "suppliers";

export async function listRealSuppliers(): Promise<RealSupplier[]> {
  // No orderBy("name") here on purpose — Firestore's orderBy silently
  // excludes any doc missing that field, and plenty of real supplier docs
  // only have name_cn (see sample data). Fetch everything, sort client-side
  // by the same fallback chain the UI displays, so nothing vanishes from
  // the picker just because it lacks an English name.
  const snap = await getDocs(collection(db, COLLECTION));
  const suppliers = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RealSupplier);
  return suppliers.sort((a, b) => supplierDisplayName(a).localeCompare(supplierDisplayName(b)));
}

export async function getRealSupplier(id: string): Promise<RealSupplier | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as RealSupplier) : null;
}

/**
 * Only the suppliers that actually have a Product Design product — for the
 * Suppliers browse page. The full costing-tool roster (hundreds of
 * suppliers) is the right list for the picker on a product's own
 * create/edit form, where the point is choosing one not used here yet, but
 * it's the wrong list to browse on its own — nothing to click through to
 * for almost all of them. Use listRealSuppliers() for pickers instead.
 */
export async function listSuppliersWithProducts(): Promise<RealSupplier[]> {
  const products = await listProducts();
  const supplierIds = Array.from(new Set(products.map((p) => p.supplierId)));
  const suppliers = await Promise.all(supplierIds.map((id) => getRealSupplier(id)));
  return suppliers
    .filter((s): s is RealSupplier => s !== null)
    .sort((a, b) => supplierDisplayName(a).localeCompare(supplierDisplayName(b)));
}
