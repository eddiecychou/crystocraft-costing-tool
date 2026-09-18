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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type GenerationInput = Omit<Generation, "id" | "createdAt" | "updatedAt">;
