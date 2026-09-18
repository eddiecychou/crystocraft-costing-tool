import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import type {
  BrandProfile,
  BrandSourceImage,
  BrandSourceWebsite,
  CustomerBrand,
} from "@/types/customerBrand";
import { emptyBrandProfile } from "@/types/customerBrand";

const COLLECTION = "pd_customer_brands";

export async function getCustomerBrand(customerId: string): Promise<CustomerBrand | null> {
  const snap = await getDoc(doc(db, COLLECTION, customerId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    ...data,
    sourceImages: data.sourceImages || [],
    sourceWebsites: data.sourceWebsites || [],
  } as CustomerBrand;
}

export async function saveCustomerBrand(
  customerId: string,
  brandJson: BrandProfile,
): Promise<void> {
  const existing = await getDoc(doc(db, COLLECTION, customerId));
  await setDoc(doc(db, COLLECTION, customerId), {
    customerId,
    brandJson,
    sourceImages: existing.exists() ? existing.data().sourceImages || [] : [],
    sourceWebsites: existing.exists() ? existing.data().sourceWebsites || [] : [],
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function addBrandSourceImage(
  customerId: string,
  file: File,
): Promise<BrandSourceImage> {
  const imageId = crypto.randomUUID();
  const storageRef = ref(storage, `pd_customer_brands/${customerId}/${imageId}-${file.name}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  const image: BrandSourceImage = { id: imageId, url, uploadedAt: new Date() as unknown as BrandSourceImage["uploadedAt"] };

  const existing = await getDoc(doc(db, COLLECTION, customerId));
  const sourceImages = existing.exists() ? [...(existing.data().sourceImages || []), image] : [image];
  await setDoc(
    doc(db, COLLECTION, customerId),
    {
      customerId,
      brandJson: existing.exists() ? existing.data().brandJson : emptyBrandProfile(),
      sourceImages,
      sourceWebsites: existing.exists() ? existing.data().sourceWebsites || [] : [],
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return image;
}

export async function removeBrandSourceImage(customerId: string, imageId: string): Promise<void> {
  const existing = await getDoc(doc(db, COLLECTION, customerId));
  if (!existing.exists()) return;
  const all: BrandSourceImage[] = existing.data().sourceImages || [];
  const target = all.find((img) => img.id === imageId);
  if (target) {
    try {
      await deleteObject(ref(storage, target.url));
    } catch {
      // already gone — don't block removing the record over it
    }
  }
  const sourceImages = all.filter((img) => img.id !== imageId);
  await setDoc(doc(db, COLLECTION, customerId), { sourceImages, updatedAt: serverTimestamp() }, { merge: true });
}

export async function addBrandSourceWebsite(
  customerId: string,
  url: string,
): Promise<BrandSourceWebsite> {
  const website: BrandSourceWebsite = {
    id: crypto.randomUUID(),
    url,
    addedAt: new Date() as unknown as BrandSourceWebsite["addedAt"],
  };
  const existing = await getDoc(doc(db, COLLECTION, customerId));
  const sourceWebsites = existing.exists()
    ? [...(existing.data().sourceWebsites || []), website]
    : [website];
  await setDoc(
    doc(db, COLLECTION, customerId),
    {
      customerId,
      brandJson: existing.exists() ? existing.data().brandJson : emptyBrandProfile(),
      sourceImages: existing.exists() ? existing.data().sourceImages || [] : [],
      sourceWebsites,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return website;
}

export async function removeBrandSourceWebsite(customerId: string, websiteId: string): Promise<void> {
  const existing = await getDoc(doc(db, COLLECTION, customerId));
  if (!existing.exists()) return;
  const sourceWebsites = (existing.data().sourceWebsites || []).filter(
    (w: BrandSourceWebsite) => w.id !== websiteId,
  );
  await setDoc(doc(db, COLLECTION, customerId), { sourceWebsites, updatedAt: serverTimestamp() }, { merge: true });
}
