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
import { db, storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import type { Generation, GenerationInput } from "@/types/generation";
import { getTemplate } from "@/lib/firestore/promptTemplates";

const COLLECTION = "pd_generations";

export async function listGenerationsForTemplate(templateId: string): Promise<Generation[]> {
  const q = query(collection(db, COLLECTION), where("templateId", "==", templateId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Generation);
}

export async function listGenerationsForProduct(productId: string): Promise<Generation[]> {
  const q = query(collection(db, COLLECTION), where("productId", "==", productId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Generation);
}

export async function getGeneration(id: string): Promise<Generation | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Generation) : null;
}

/**
 * Log an already-produced result image against its template. This app
 * never calls Gemini itself (that happens directly in the Gemini app, per
 * the workflow's Half A) — a generation record is created by uploading the
 * actual output, not by triggering a render. promptJsonSnapshot freezes the
 * template's JSON at this moment so editing the template later never
 * rewrites what actually produced an already-saved image.
 */
export async function createGeneration(
  templateId: string,
  file: File,
  opts: { note?: string } = {},
): Promise<string> {
  const template = await getTemplate(templateId);
  if (!template) throw new Error("Template not found");

  const generationId = crypto.randomUUID();
  const storageRef = ref(storage, `pd_generations/${templateId}/${generationId}-${file.name}`);
  await uploadBytes(storageRef, file);
  const resultImageUrl = await getDownloadURL(storageRef);

  const input: GenerationInput = {
    templateId,
    productId: template.productId,
    customerId: template.customerId,
    resultImageUrl,
    promptJsonSnapshot: template.promptJson,
    status: "success",
    tags: [],
    ...(opts.note ? { note: opts.note } : {}),
  };
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateGeneration(
  id: string,
  input: Partial<GenerationInput>,
): Promise<void> {
  // An explicit `undefined` here means "clear this field" (e.g. rating
  // going back to unrated) — translate it to deleteField() rather than
  // relying on ignoreUndefinedProperties, which would just drop the key
  // from the write and leave the old value in place (updateDoc merges).
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, value] of Object.entries(input)) {
    data[key] = value === undefined ? deleteField() : value;
  }
  await updateDoc(doc(db, COLLECTION, id), data);
}

export async function deleteGeneration(id: string, resultImageUrl: string): Promise<void> {
  // Best-effort Storage cleanup — derive the object's ref from its own
  // download URL rather than trying to reconstruct the path, since the
  // filename includes the original upload's name.
  try {
    await deleteObject(ref(storage, resultImageUrl));
  } catch {
    // If the object is already gone (or the URL can't be resolved to a
    // ref for some reason), don't block deleting the record over it.
  }
  await deleteDoc(doc(db, COLLECTION, id));
}
