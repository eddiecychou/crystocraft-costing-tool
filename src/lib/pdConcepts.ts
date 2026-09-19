import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getProduct } from "@/lib/firestore/products";
import { listGenerationsForTemplate } from "@/lib/firestore/generations";
import type { PromptTemplate } from "@/types/promptTemplate";
import type { Product } from "@/types/product";

export interface ApprovedConcept {
  template: PromptTemplate;
  product: Product | null;
  thumbUrl?: string;
}

// Every APPROVED Product Design template, resolved with its product and
// best-available thumbnail (an approved generation's render if there is
// one, else the template's own source photo). Shared by the per-customer
// "Product Design Concepts" card (CustomerDetail.jsx) and the global
// gallery on the Product Design home page (Products.tsx) — same
// resolution logic, different grouping. Pass `customerId` to scope to one
// customer; omit it for the global overview.
//
// Two equality-only filters (status + optional customerId) — Firestore
// covers this with its automatic single-field indexes via index merging,
// no composite index needed (unlike an orderBy/range clause).
export async function listApprovedConcepts(customerId?: string): Promise<ApprovedConcept[]> {
  const base = collection(db, "pd_prompt_templates");
  const q = customerId
    ? query(base, where("status", "==", "approved"), where("customerId", "==", customerId))
    : query(base, where("status", "==", "approved"));
  const snap = await getDocs(q);
  const templates = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PromptTemplate);
  return Promise.all(
    templates.map(async (t) => {
      const [product, gens] = await Promise.all([
        getProduct(t.productId),
        listGenerationsForTemplate(t.id),
      ]);
      const bestGen = gens.find((g) => g.status === "approved") || gens[0] || null;
      const thumbUrl =
        bestGen?.resultImageUrl ||
        product?.images.find((i) => i.id === t.sourceImageId)?.url ||
        product?.images[0]?.url;
      return { template: t, product, thumbUrl };
    }),
  );
}
