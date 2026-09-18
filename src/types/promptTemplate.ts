import type { Timestamp } from "firebase/firestore";

export interface PromptTemplate {
  id: string;
  name: string;
  type: "base" | "variant";
  parentTemplateId?: string;
  productId: string;
  supplierId: string; // denormalized from the product, for filtering
  customerId: string;
  sourceImageId?: string; // which of the product's images this was built from
  promptJson: Record<string, unknown>;
  lockedPaths?: string[]; // leaf paths (see lib/jsonPaths.ts) the owner has pinned — AI tweaks/merges must not touch these
  extractionNote?: string;
  tags: string[];
  status: "draft" | "approved" | "archived";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PromptTemplateInput = Omit<PromptTemplate, "id" | "createdAt" | "updatedAt">;
