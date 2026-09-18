import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  orderBy,
  query,
  where,
  serverTimestamp,
  arrayUnion,
} from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL, listAll, deleteObject } from "firebase/storage";
import type { Product, ProductInput, ProductImage } from "@/types/product";

const COLLECTION = "pd_products";

export async function listProducts(): Promise<Product[]> {
  const q = query(collection(db, COLLECTION), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
}

export async function listProductsBySupplier(supplierId: string): Promise<Product[]> {
  const q = query(collection(db, COLLECTION), where("supplierId", "==", supplierId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
}

export async function getProduct(id: string): Promise<Product | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Product) : null;
}

export async function createProduct(input: ProductInput): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), {
    ...input,
    images: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<void> {
  // An explicit `undefined` (e.g. category cleared to "") means "remove
  // this field" — translate to deleteField() so it actually clears rather
  // than being dropped from the write and leaving the old value in place
  // (see firebase.ts's ignoreUndefinedProperties note).
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, value] of Object.entries(input)) {
    data[key] = value === undefined ? deleteField() : value;
  }
  await updateDoc(doc(db, COLLECTION, id), data);
}

export async function deleteProduct(id: string): Promise<void> {
  // Delete the uploaded reference photos in Storage first, then the doc —
  // otherwise every image ever uploaded for a deleted product sits orphaned
  // in pd_products/{id}/ forever with nothing left to point at it.
  const folderRef = ref(storage, `pd_products/${id}`);
  const listing = await listAll(folderRef);
  await Promise.all(listing.items.map((item) => deleteObject(item)));
  await deleteDoc(doc(db, COLLECTION, id));
}

export async function addProductImage(
  productId: string,
  file: File,
  opts: { isBaseReference?: boolean; caption?: string } = {},
): Promise<ProductImage> {
  const imageId = crypto.randomUUID();
  const storageRef = ref(storage, `pd_products/${productId}/${imageId}-${file.name}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  const image: ProductImage = {
    id: imageId,
    url,
    isBaseReference: opts.isBaseReference ?? false,
    // Firestore rejects `undefined` field values, including inside
    // arrayUnion — omit the key entirely rather than set it to undefined.
    ...(opts.caption ? { caption: opts.caption } : {}),
    // Firestore also rejects serverTimestamp() inside arrayUnion — use a
    // client timestamp for per-image uploadedAt instead.
    uploadedAt: new Date() as unknown as ProductImage["uploadedAt"],
  };
  await updateDoc(doc(db, COLLECTION, productId), {
    images: arrayUnion(image),
    updatedAt: serverTimestamp(),
  });
  return image;
}

// Images are edited by rewriting the whole array (arrayUnion/arrayRemove
// need exact object equality, which breaks the moment any field on an
// existing image changes) — always go through the current product doc.
async function replaceImages(productId: string, images: ProductImage[]): Promise<void> {
  await updateDoc(doc(db, COLLECTION, productId), { images, updatedAt: serverTimestamp() });
}

export async function setBaseReferenceImage(productId: string, imageId: string): Promise<void> {
  const product = await getProduct(productId);
  if (!product) return;
  const images = product.images.map((img) => ({ ...img, isBaseReference: img.id === imageId }));
  await replaceImages(productId, images);
}

export async function updateImageCaption(
  productId: string,
  imageId: string,
  caption: string,
): Promise<void> {
  const product = await getProduct(productId);
  if (!product) return;
  const images = product.images.map((img) =>
    img.id === imageId
      ? caption
        ? { ...img, caption }
        : { ...img, caption: undefined }
      : img,
  ).map((img) => {
    // strip the key entirely when cleared, same undefined rule as above
    if (img.caption === undefined) {
      const { caption: _drop, ...rest } = img;
      return rest as ProductImage;
    }
    return img;
  });
  await replaceImages(productId, images);
}

export async function removeProductImage(productId: string, imageId: string): Promise<void> {
  const product = await getProduct(productId);
  if (!product) return;
  const images = product.images.filter((img) => img.id !== imageId);
  await replaceImages(productId, images);
}

export async function saveImageAnalysis(
  productId: string,
  imageId: string,
  analysisJson: Record<string, unknown>,
): Promise<void> {
  const product = await getProduct(productId);
  if (!product) return;
  const images = product.images.map((img) => (img.id === imageId ? { ...img, analysisJson } : img));
  await replaceImages(productId, images);
}
