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

// "Music Box Design A — v3" -> "...— v4"; anything without a trailing
// "— vN" just gets " — v2" appended (the first duplicate of an un-versioned
// name is naturally its v2).
function nextVersionName(name: string): string {
  const m = name.match(/^(.*—\s*v)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name} — v2`;
}

// Copies a template into a new draft, including promptJson AND lockedPaths —
// Eddie, 2026-09-19: "When I have a success one, I want to duplicate to a
// new version while keeping the locks... Right now I have to copy the json
// to a new one but the lock is gone." Locks are worth preserving specifically
// because they're what a successful template is protecting (a proven
// physical-facts/brand section an AI tweak or merge must not touch) — losing
// them on every new version defeats the point of locking anything at all.
// Uses the `type`/`parentTemplateId` fields already in PromptTemplate (set
// nowhere until now) to record the lineage.
// `overrides` lets the Edit page duplicate its current IN-EDITOR state
// (including unsaved changes) instead of re-fetching the last-saved
// version — the whole point is branching off the version you're looking at
// right now.
export async function duplicateTemplate(
  id: string,
  overrides?: { promptJson?: Record<string, unknown>; lockedPaths?: string[] },
): Promise<string> {
  const original = await getTemplate(id);
  if (!original) throw new Error("Template not found");
  return createTemplate({
    name: nextVersionName(original.name),
    type: "variant",
    parentTemplateId: original.id,
    productId: original.productId,
    supplierId: original.supplierId,
    customerId: original.customerId,
    sourceImageId: original.sourceImageId,
    promptJson: overrides?.promptJson ?? JSON.parse(JSON.stringify(original.promptJson)),
    lockedPaths: overrides?.lockedPaths ?? (original.lockedPaths ? [...original.lockedPaths] : []),
    extractionNote: original.extractionNote,
    tags: [...original.tags],
    status: "draft",
  });
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
