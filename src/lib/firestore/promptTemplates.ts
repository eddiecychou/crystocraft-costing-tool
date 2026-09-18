import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { PromptTemplate, PromptTemplateInput } from "@/types/promptTemplate";

const COLLECTION = "pd_prompt_templates";

export async function listTemplatesForProduct(productId: string): Promise<PromptTemplate[]> {
  const q = query(collection(db, COLLECTION), where("productId", "==", productId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PromptTemplate);
}

export async function listTemplatesForCustomer(customerId: string): Promise<PromptTemplate[]> {
  const q = query(collection(db, COLLECTION), where("customerId", "==", customerId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PromptTemplate);
}

export async function getTemplate(id: string): Promise<PromptTemplate | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as PromptTemplate) : null;
}

export async function createTemplate(input: PromptTemplateInput): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTemplate(
  id: string,
  input: Partial<PromptTemplateInput>,
): Promise<void> {
  // See products.ts's updateProduct for why: an explicit `undefined` means
  // "remove this field," translated to deleteField() so it actually clears.
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, value] of Object.entries(input)) {
    data[key] = value === undefined ? deleteField() : value;
  }
  await updateDoc(doc(db, COLLECTION, id), data);
}

export async function deleteTemplate(id: string): Promise<void> {
  // Cascade: a generation belongs to exactly this template (see
  // generations.ts's promptJsonSnapshot comment) — nothing else references
  // it, so leaving it behind after its template is gone orphans both the
  // Firestore doc and its Storage file forever. Deliberately reimplements
  // the delete here (not calling generations.ts's deleteGeneration) to
  // avoid a circular import — that module already imports getTemplate from
  // this one.
  const genSnap = await getDocs(
    query(collection(db, "pd_generations"), where("templateId", "==", id)),
  );
  await Promise.all(
    genSnap.docs.map(async (genDoc) => {
      const resultImageUrl = (genDoc.data() as { resultImageUrl?: string }).resultImageUrl;
      if (resultImageUrl) {
        try {
          await deleteObject(ref(storage, resultImageUrl));
        } catch {
          // already gone — don't block deleting the record over it
        }
      }
      await deleteDoc(genDoc.ref);
    }),
  );
  await deleteDoc(doc(db, COLLECTION, id));
}
