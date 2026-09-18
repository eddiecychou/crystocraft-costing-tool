import type { Timestamp } from "firebase/firestore";

export interface ProductImage {
  id: string;
  url: string;
  isBaseReference: boolean;
  caption?: string;
  uploadedAt: Timestamp;
  // Gemini's structured-JSON description of this specific image (Half A
  // step 1) — reusable across every template built from this image, so
  // it's cached here rather than re-analyzed per template.
  analysisJson?: Record<string, unknown>;
}

export interface Product {
  id: string;
  supplierId: string;
  name: string;
  category?: string;
  dimensions?: { w: number; h: number; d: number; unit: "mm" | "cm" };
  images: ProductImage[];
  linkedCorpGiftProductId?: string;
  tags: string[];
  status: "active" | "inactive";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ProductInput = Omit<Product, "id" | "createdAt" | "updatedAt" | "images">;
