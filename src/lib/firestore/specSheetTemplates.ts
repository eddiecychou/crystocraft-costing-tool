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
import { db } from "@/lib/firebase";
import type { SpecSheetTemplate, SpecSheetTemplateInput } from "@/types/specSheetTemplate";

const COLLECTION = "pd_spec_sheet_templates";

export async function listSpecSheetsForProduct(productId: string): Promise<SpecSheetTemplate[]> {
  const q = query(collection(db, COLLECTION), where("productId", "==", productId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SpecSheetTemplate);
}

export async function getSpecSheet(id: string): Promise<SpecSheetTemplate | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as SpecSheetTemplate) : null;
}

export async function createSpecSheet(input: SpecSheetTemplateInput): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSpecSheet(
  id: string,
  input: Partial<SpecSheetTemplateInput>,
): Promise<void> {
  // Same deleteField() convention as promptTemplates.ts — an explicit
  // `undefined` means "clear this field," not "leave it alone."
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, value] of Object.entries(input)) {
    data[key] = value === undefined ? deleteField() : value;
  }
  await updateDoc(doc(db, COLLECTION, id), data);
}

export async function deleteSpecSheet(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
