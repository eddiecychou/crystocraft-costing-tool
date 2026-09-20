import type { Timestamp } from "firebase/firestore";

export interface Generation {
  id: string;
  templateId: string;
  productId: string; // denormalized from the template
  customerId: string; // denormalized from the template
  resultImageUrl: string;
  // Frozen copy of the template's promptJson AT GENERATION TIME — editing
  // the template later must not rewrite what actually produced this image.
  promptJsonSnapshot: Record<string, unknown>;
  status: "success" | "failed" | "approved" | "rejected";
  rating?: number; // 1-5
  note?: string;
  tags: string[];
  // Which real catalogue product (if any) this exact image has been pushed
  // to — set by TemplateDetail.tsx's "+ New Corp Gift"/"+ Add to Existing"
  // actions. Eddie, 2026-09-21: "each image will only link to 1 product, so
  // this should be the right way to do" — one generation, at most one
  // linked product, shown back on the card so it's obvious at a glance
  // whether an image has already been pushed anywhere.
  linkedProduct?: { type: "corp_gift" | "range"; id: string; name: string };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type GenerationInput = Omit<Generation, "id" | "createdAt" | "updatedAt">;
