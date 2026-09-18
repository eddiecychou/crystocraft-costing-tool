import type { Timestamp } from "firebase/firestore";

export interface SpecSheetField {
  label: string;
  value: string;
}

export interface SpecSheetTemplate {
  id: string;
  productId: string;
  name: string;
  photoUrl?: string; // one of the product's own images, chosen at build time
  tagline?: string;
  fields: SpecSheetField[]; // dimensions, materials, SKU, MOQ, price, etc. — free-form, ordered
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SpecSheetTemplateInput = Omit<SpecSheetTemplate, "id" | "createdAt" | "updatedAt">;
