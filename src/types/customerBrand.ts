import type { Timestamp } from "firebase/firestore";

/**
 * The customer's own Visual Tokens (ATELIER-ART-ENGINE.md's Brand
 * Deconstruction Framework: palette, motifs, tone, negative space, logo
 * description) — the known fields the UI renders as a real form (list
 * add/edit/delete, not raw JSON). Any OTHER key a Gemini extraction or a
 * hand-edit adds beyond this set is preserved (round-tripped through the
 * "Other fields" raw-JSON fallback) rather than silently dropped.
 */
export interface BrandProfile {
  // A short narrative — positioning, values, feel — distinct from the
  // itemized fields below. What a template's Apply Brand step reads for
  // overall direction, not a literal field it substitutes.
  summary: string;
  color_palette: string[];
  core_motifs: string[];
  tone: string;
  negative_space_rule: string;
  // Reference only — describes the logo in words for the record. Never
  // sent to Gemini as something to draw (see apply-brand's reserved_areas).
  logo_description: string;
  notes: string;
  [key: string]: unknown;
}

export function emptyBrandProfile(): BrandProfile {
  return {
    summary: "",
    color_palette: [],
    core_motifs: [],
    tone: "",
    negative_space_rule: "",
    logo_description: "",
    notes: "",
  };
}

export interface BrandSourceImage {
  id: string;
  url: string;
  uploadedAt: Timestamp;
}

export interface BrandSourceWebsite {
  id: string;
  url: string;
  addedAt: Timestamp;
}

/**
 * What a Gemini extraction (image or website) proposes — every field
 * optional since a given source may not surface all of them. Reviewed
 * per-item before anything is added to the actual BrandProfile.
 */
export interface BrandExtraction {
  summary?: string;
  color_palette?: string[];
  core_motifs?: string[];
  tone?: string;
  negative_space_rule?: string;
  logo_description?: string;
}

/**
 * Product-Design-owned data about a real customer, since costing-tool's own
 * `customers` collection has no such field and shouldn't gain one for this
 * app's sake. One doc per customer, doc id == the real customer's id.
 */
export interface CustomerBrand {
  customerId: string;
  brandJson: BrandProfile;
  sourceImages: BrandSourceImage[];
  sourceWebsites: BrandSourceWebsite[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
