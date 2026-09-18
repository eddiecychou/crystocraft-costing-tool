import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { authHeader } from "@/firebase";
import { getRealCustomer } from "@/lib/firestore/realCustomers";
import {
  getCustomerBrand,
  saveCustomerBrand,
  addBrandSourceImage,
  removeBrandSourceImage,
  addBrandSourceWebsite,
  removeBrandSourceWebsite,
} from "@/lib/firestore/customerBrands";
import { customerDisplayName, type RealCustomer } from "@/types/customer";
import {
  emptyBrandProfile,
  type BrandProfile,
  type BrandSourceImage,
  type BrandSourceWebsite,
  type BrandExtraction,
} from "@/types/customerBrand";

const KNOWN_KEYS = [
  "summary",
  "color_palette",
  "core_motifs",
  "tone",
  "negative_space_rule",
  "logo_description",
  "notes",
];

const SCALAR_FIELDS = ["summary", "tone", "negative_space_rule", "logo_description"] as const;
const SCALAR_LABELS: Record<(typeof SCALAR_FIELDS)[number], string> = {
  summary: "Summary",
  tone: "Tone",
  negative_space_rule: "Negative Space Rule",
  logo_description: "Logo Description",
};

interface ReviewState {
  scalars: Record<(typeof SCALAR_FIELDS)[number], boolean>;
  colors: boolean[];
  motifs: boolean[];
}

interface MergeGroup {
  keep: string;
  merge_indices: number[];
  accepted: boolean;
}

interface MergeReview {
  itemType: "motifs" | "colors";
  items: string[]; // snapshot at the time merge was requested
  groups: MergeGroup[];
}

export default function CustomerBrandPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<RealCustomer | null | "loading">("loading");
  const [profile, setProfile] = useState<BrandProfile>(emptyBrandProfile());
  const [sourceImages, setSourceImages] = useState<BrandSourceImage[]>([]);
  const [sourceWebsites, setSourceWebsites] = useState<BrandSourceWebsite[]>([]);
  const [hasExisting, setHasExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [newColor, setNewColor] = useState("#000000");
  const [newMotif, setNewMotif] = useState("");
  const [newWebsiteUrl, setNewWebsiteUrl] = useState("");

  const [uploading, setUploading] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");
  const [extracted, setExtracted] = useState<BrandExtraction | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [merging, setMerging] = useState<"motifs" | "colors" | null>(null);
  const [mergeError, setMergeError] = useState("");
  const [mergeReview, setMergeReview] = useState<MergeReview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const b = await getCustomerBrand(id);
    if (b) {
      setProfile({ ...emptyBrandProfile(), ...b.brandJson });
      setSourceImages(b.sourceImages || []);
      setSourceWebsites(b.sourceWebsites || []);
      setHasExisting(true);
    }
  }

  useEffect(() => {
    getRealCustomer(id).then(setCustomer);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave() {
    setBusy(true);
    await saveCustomerBrand(id, profile);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateField<K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  function addColor() {
    if (!newColor) return;
    updateField("color_palette", [...profile.color_palette, newColor]);
    setNewColor("#000000");
  }
  function removeColor(i: number) {
    updateField("color_palette", profile.color_palette.filter((_, idx) => idx !== i));
  }
  function addMotif() {
    if (!newMotif.trim()) return;
    updateField("core_motifs", [...profile.core_motifs, newMotif.trim()]);
    setNewMotif("");
  }
  function removeMotif(i: number) {
    updateField("core_motifs", profile.core_motifs.filter((_, idx) => idx !== i));
  }

  const otherKeys = Object.keys(profile).filter((k) => !KNOWN_KEYS.includes(k));

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await addBrandSourceImage(id, file);
    }
    await refresh();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleRemoveImage(imageId: string) {
    await removeBrandSourceImage(id, imageId);
    await refresh();
  }

  async function handleAddWebsite() {
    if (!newWebsiteUrl.trim()) return;
    setAddingWebsite(true);
    await addBrandSourceWebsite(id, newWebsiteUrl.trim());
    setNewWebsiteUrl("");
    await refresh();
    setAddingWebsite(false);
  }

  async function handleRemoveWebsite(websiteId: string) {
    await removeBrandSourceWebsite(id, websiteId);
    await refresh();
  }

  function startReview(result: BrandExtraction) {
    setExtracted(result);
    setReview({
      // Default-checked whenever the extraction found something — accepting
      // now APPENDS to an existing scalar rather than replacing it (see
      // acceptSelected), so pre-checking doesn't risk losing anything from
      // an earlier website/image analysis. A field only stays unchecked by
      // default when this extraction found nothing for it.
      scalars: {
        summary: !!result.summary,
        tone: !!result.tone,
        negative_space_rule: !!result.negative_space_rule,
        logo_description: !!result.logo_description,
      },
      colors: (result.color_palette || []).map(
        (hex) => !profile.color_palette.some((c) => c.toLowerCase() === hex.toLowerCase()),
      ),
      motifs: (result.core_motifs || []).map((m) => !profile.core_motifs.includes(m)),
    });
  }

  // Combine rather than replace — two sources (e.g. the website's summary
  // and a logo image's) should both survive, not have the second overwrite
  // the first. Skips the append if the new text is already contained in the
  // existing value (re-analyzing the same source shouldn't duplicate it).
  function appendText(existing: string, addition: string): string {
    if (!existing) return addition;
    if (!addition || existing.includes(addition)) return existing;
    return `${existing}\n\n${addition}`;
  }

  async function handleAnalyzeImage(img: BrandSourceImage) {
    setAnalyzingKey(img.id);
    setAnalyzeError("");
    setExtracted(null);
    try {
      const res = await fetch("/api/pd-analyze-brand-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ imageUrl: img.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      startReview(data.extracted);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzingKey(null);
    }
  }

  async function handleAnalyzeWebsite(site: BrandSourceWebsite) {
    setAnalyzingKey(site.id);
    setAnalyzeError("");
    setExtracted(null);
    try {
      const res = await fetch("/api/pd-analyze-brand-website", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ url: site.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      startReview(data.extracted);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzingKey(null);
    }
  }

  function acceptSelected() {
    if (!extracted || !review) return;
    setProfile((p) => {
      const next = { ...p };
      for (const key of SCALAR_FIELDS) {
        if (review.scalars[key] && extracted[key]) {
          next[key] = appendText(next[key] as string, extracted[key] as string);
        }
      }
      const acceptedColors = (extracted.color_palette || []).filter((_, i) => review.colors[i]);
      next.color_palette = Array.from(new Set([...p.color_palette, ...acceptedColors]));
      const acceptedMotifs = (extracted.core_motifs || []).filter((_, i) => review.motifs[i]);
      next.core_motifs = Array.from(new Set([...p.core_motifs, ...acceptedMotifs]));
      return next;
    });
    setExtracted(null);
    setReview(null);
  }

  async function handleMerge(itemType: "motifs" | "colors") {
    const items = itemType === "motifs" ? profile.core_motifs : profile.color_palette;
    if (items.length < 2) return;
    setMerging(itemType);
    setMergeError("");
    setMergeReview(null);
    try {
      const res = await fetch("/api/pd-merge-elements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ items, itemType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      const groups: MergeGroup[] = (data.groups || []).map((g: { keep: string; merge_indices: number[] }) => ({
        ...g,
        accepted: true,
      }));
      if (groups.length === 0) {
        setMergeError(`No likely duplicates found among the current ${itemType}.`);
      } else {
        setMergeReview({ itemType, items, groups });
      }
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMerging(null);
    }
  }

  function applyMerges() {
    if (!mergeReview) return;
    const { itemType, items, groups } = mergeReview;
    const acceptedGroups = groups.filter((g) => g.accepted);
    const mergedAwayIndices = new Set(acceptedGroups.flatMap((g) => g.merge_indices));
    // Keep every item not swallowed by an accepted group, plus one "keep"
    // label per accepted group — order doesn't matter for these lists.
    const survivors = items.filter((_, i) => !mergedAwayIndices.has(i));
    const kept = acceptedGroups.map((g) => g.keep);
    const merged = Array.from(new Set([...survivors, ...kept]));
    if (itemType === "motifs") updateField("core_motifs", merged);
    else updateField("color_palette", merged);
    setMergeReview(null);
  }

  if (customer === "loading") return <main className="p-10 text-ink-60">Loading…</main>;
  if (!customer) return <main className="p-10 text-ink-60">Customer not found.</main>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl">Brand Profile</h1>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? "Saving…" : saved ? "Saved ✓" : hasExisting ? "Save Changes" : "Create Brand Profile"}
        </button>
      </div>
      <p className="text-sm text-ink-60 mb-6">
        {customerDisplayName(customer)} — the Visual Tokens used when
        applying this brand to a template. Product Design&rsquo;s own data,
        not part of the costing-tool CRM record.
      </p>

      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-6">
          <div className="card p-4">
            <label className="label" htmlFor="summary">Summary</label>
            <textarea
              id="summary"
              className="input"
              rows={3}
              value={profile.summary}
              onChange={(e) => updateField("summary", e.target.value)}
              placeholder="A short narrative — positioning, values, what the brand is known for"
            />
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="eyebrow">Color Palette</h2>
              {profile.color_palette.length > 1 && (
                <button
                  type="button"
                  className="text-2xs text-ink-60 uppercase tracking-wide hover:text-ink"
                  onClick={() => handleMerge("colors")}
                  disabled={merging === "colors"}
                >
                  {merging === "colors" ? "Checking…" : "Merge Similar"}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {profile.color_palette.map((hex, i) => (
                <div key={i} className="flex items-center gap-1.5 border border-warm-grey px-2 py-1">
                  <span className="h-4 w-4 border border-warm-grey" style={{ backgroundColor: hex }} />
                  <span className="text-xs font-mono">{hex}</span>
                  <button type="button" onClick={() => removeColor(i)} className="text-ink-60 hover:text-red-700 text-xs">×</button>
                </div>
              ))}
              {profile.color_palette.length === 0 && <p className="text-xs text-ink-60">No colors yet.</p>}
            </div>
            <div className="flex gap-2">
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-8 w-8 border border-warm-grey" />
              <input className="input flex-1" value={newColor} onChange={(e) => setNewColor(e.target.value)} placeholder="#RRGGBB" />
              <button type="button" className="btn btn-secondary" onClick={addColor}>Add</button>
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="eyebrow">Core Motifs</h2>
              {profile.core_motifs.length > 1 && (
                <button
                  type="button"
                  className="text-2xs text-ink-60 uppercase tracking-wide hover:text-ink"
                  onClick={() => handleMerge("motifs")}
                  disabled={merging === "motifs"}
                >
                  {merging === "motifs" ? "Checking…" : "Merge Similar"}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {profile.core_motifs.map((m, i) => (
                // .tag is nowrap by default (for short filter chips elsewhere) — an
                // AI-extracted motif can be a long phrase, which forced this whole
                // page to scroll horizontally instead of wrapping. Override to wrap
                // within the column instead.
                <span key={i} className="tag whitespace-normal break-words max-w-full items-start">
                  <span className="min-w-0">{m}</span>
                  <button type="button" onClick={() => removeMotif(i)} className="ml-1 hover:text-red-700 shrink-0">×</button>
                </span>
              ))}
              {profile.core_motifs.length === 0 && <p className="text-xs text-ink-60">No motifs yet.</p>}
            </div>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={newMotif}
                onChange={(e) => setNewMotif(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMotif(); } }}
                placeholder="e.g. school crest, swimming pool"
              />
              <button type="button" className="btn btn-secondary" onClick={addMotif}>Add</button>
            </div>
          </div>

          <div className="card p-4">
            <label className="label" htmlFor="tone">Tone</label>
            <input id="tone" className="input mb-3" value={profile.tone} onChange={(e) => updateField("tone", e.target.value)} placeholder="e.g. heritage, formal, trustworthy" />
            <label className="label" htmlFor="negspace">Negative Space Rule</label>
            <input id="negspace" className="input mb-3" value={profile.negative_space_rule} onChange={(e) => updateField("negative_space_rule", e.target.value)} placeholder="e.g. keep 60% calm sky/water area" />
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" className="input" rows={3} value={profile.notes} onChange={(e) => updateField("notes", e.target.value)} />
          </div>

          <div className="card p-4 bg-brand-50 border-brand-100">
            <label className="label" htmlFor="logo">Logo Description (reference only)</label>
            <textarea
              id="logo"
              className="input"
              rows={3}
              value={profile.logo_description}
              onChange={(e) => updateField("logo_description", e.target.value)}
              placeholder="Shape, colors, layout — words only"
            />
            <p className="text-xs text-ink-70 mt-2">
              Never sent to Gemini as something to draw. Applying this brand
              to a template reserves a blank area for the real logo instead,
              composited by hand afterward.
            </p>
          </div>

          {otherKeys.length > 0 && (
            <div className="card p-4">
              <h2 className="eyebrow mb-2">Other Fields</h2>
              <p className="text-xs text-ink-60 mb-2">
                Not part of the known schema above (from an older save) —
                kept, shown read-only here.
              </p>
              <pre className="text-xs font-mono bg-ivory p-2 overflow-x-auto">
                {JSON.stringify(Object.fromEntries(otherKeys.map((k) => [k, profile[k]])), null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="eyebrow">Reference Images</h2>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                id="brandImgUpload"
                onChange={(e) => handleUpload(e.target.files)}
              />
              <label htmlFor="brandImgUpload" className="btn btn-secondary cursor-pointer">
                {uploading ? "Uploading…" : "Upload"}
              </label>
            </div>
            <p className="text-xs text-ink-60 mb-3">
              Logo, marketing material, brand guideline pages.
            </p>
            {sourceImages.length === 0 ? (
              <p className="text-xs text-ink-60">No images yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {sourceImages.map((img) => (
                  <div key={img.id} className="card overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="w-full h-24 object-cover" />
                    <div className="p-1.5 flex flex-col gap-1">
                      <button
                        type="button"
                        className="text-2xs text-ink-60 uppercase tracking-wide hover:text-ink text-left"
                        onClick={() => handleAnalyzeImage(img)}
                        disabled={analyzingKey === img.id}
                      >
                        {analyzingKey === img.id ? "Analyzing…" : "Analyze with Gemini"}
                      </button>
                      <button
                        type="button"
                        className="text-2xs text-red-700 uppercase tracking-wide text-left hover:underline"
                        onClick={() => handleRemoveImage(img.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <h2 className="eyebrow mb-2">Website</h2>
            <p className="text-xs text-ink-60 mb-3">
              Gemini reads the page directly (no screenshot needed) — fails
              clearly here if a site can&rsquo;t be reached rather than
              guessing.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                className="input flex-1"
                value={newWebsiteUrl}
                onChange={(e) => setNewWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
              />
              <button type="button" className="btn btn-secondary" onClick={handleAddWebsite} disabled={addingWebsite}>
                {addingWebsite ? "Adding…" : "Add"}
              </button>
            </div>
            {sourceWebsites.length === 0 ? (
              <p className="text-xs text-ink-60">No websites yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sourceWebsites.map((site) => (
                  <div key={site.id} className="flex items-center justify-between border border-warm-grey px-2 py-1.5">
                    <span className="text-xs truncate flex-1">{site.url}</span>
                    <button
                      type="button"
                      className="text-2xs text-ink-60 uppercase tracking-wide hover:text-ink ml-2"
                      onClick={() => handleAnalyzeWebsite(site)}
                      disabled={analyzingKey === site.id}
                    >
                      {analyzingKey === site.id ? "Analyzing…" : "Analyze"}
                    </button>
                    <button
                      type="button"
                      className="text-2xs text-red-700 uppercase tracking-wide ml-2 hover:underline"
                      onClick={() => handleRemoveWebsite(site.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {analyzeError && (
            <div className="card p-4 border-red-700">
              <p className="text-xs text-red-700">{analyzeError}</p>
            </div>
          )}

          {mergeError && (
            <div className="card p-4 border-red-700">
              <p className="text-xs text-red-700">{mergeError}</p>
            </div>
          )}

          {mergeReview && (
            <div className="card p-4">
              <h2 className="eyebrow mb-1">
                Merge {mergeReview.itemType === "motifs" ? "Motifs" : "Colors"} — verify each group
              </h2>
              <p className="text-xs text-ink-60 mb-3">
                Uncheck any group that isn&rsquo;t really a duplicate. Nothing
                changes until you click Apply Merges — still needs Save at
                the top to persist.
              </p>
              <div className="flex flex-col gap-3 mb-4">
                {mergeReview.groups.map((g, gi) => (
                  <label key={gi} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={g.accepted}
                      onChange={(e) =>
                        setMergeReview((r) => {
                          if (!r) return r;
                          const groups = [...r.groups];
                          groups[gi] = { ...groups[gi], accepted: e.target.checked };
                          return { ...r, groups };
                        })
                      }
                      className="mt-0.5"
                    />
                    <span>
                      {mergeReview.itemType === "colors" && (
                        <span
                          className="inline-block h-3.5 w-3.5 border border-warm-grey align-middle mr-1"
                          style={{ backgroundColor: g.keep }}
                        />
                      )}
                      Keep <strong>{g.keep}</strong> — merges:{" "}
                      {g.merge_indices
                        .map((i) => mergeReview.items[i])
                        .filter((it) => it !== g.keep)
                        .join(", ")}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" onClick={applyMerges}>
                  Apply Merges
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setMergeReview(null)}>
                  Discard
                </button>
              </div>
            </div>
          )}

          {extracted && review && (
            <div className="card p-4">
              <h2 className="eyebrow mb-1">Extracted — verify each item</h2>
              <p className="text-xs text-ink-60 mb-3">
                Nothing here is applied until you check it and click Add
                Selected — and even then, still needs Save at the top to
                persist.
              </p>

              <div className="flex flex-col gap-2 mb-4">
                {SCALAR_FIELDS.filter((key) => extracted[key]).map((key) => (
                  <label key={key} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={review.scalars[key]}
                      onChange={(e) =>
                        setReview((r) => (r ? { ...r, scalars: { ...r.scalars, [key]: e.target.checked } } : r))
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <strong>{SCALAR_LABELS[key]}:</strong> {extracted[key]}
                      {profile[key] && (
                        <span className="text-ink-60"> (adds to current: &ldquo;{String(profile[key]).slice(0, 40)}&rdquo;)</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

              {(extracted.color_palette?.length || 0) > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium mb-1.5">Colors</p>
                  <div className="flex flex-col gap-1.5">
                    {extracted.color_palette!.map((hex, i) => (
                      <label key={i} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={review.colors[i]}
                          onChange={(e) =>
                            setReview((r) => {
                              if (!r) return r;
                              const colors = [...r.colors];
                              colors[i] = e.target.checked;
                              return { ...r, colors };
                            })
                          }
                        />
                        <span className="h-3.5 w-3.5 border border-warm-grey" style={{ backgroundColor: hex }} />
                        <span className="font-mono">{hex}</span>
                        {profile.color_palette.some((c) => c.toLowerCase() === hex.toLowerCase()) && (
                          <span className="text-ink-60">(already have it)</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(extracted.core_motifs?.length || 0) > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium mb-1.5">Motifs</p>
                  <div className="flex flex-col gap-1.5">
                    {extracted.core_motifs!.map((m, i) => (
                      <label key={i} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={review.motifs[i]}
                          onChange={(e) =>
                            setReview((r) => {
                              if (!r) return r;
                              const motifs = [...r.motifs];
                              motifs[i] = e.target.checked;
                              return { ...r, motifs };
                            })
                          }
                        />
                        <span>{m}</span>
                        {profile.core_motifs.includes(m) && <span className="text-ink-60">(already have it)</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" onClick={acceptSelected}>
                  Add Selected
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setExtracted(null); setReview(null); }}
                >
                  Discard All
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
