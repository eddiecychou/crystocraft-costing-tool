import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useParams, useNavigate } from "react-router-dom";
import { getTemplate, deleteTemplate, duplicateTemplate } from "@/lib/firestore/promptTemplates";
import { getProduct, addProductImage } from "@/lib/firestore/products";
import { getRealCustomer } from "@/lib/firestore/realCustomers";
import {
  listGenerationsForTemplate,
  createGeneration,
  updateGeneration,
  deleteGeneration,
} from "@/lib/firestore/generations";
import { customerDisplayName, type RealCustomer } from "@/types/customer";
import type { PromptTemplate } from "@/types/promptTemplate";
import type { Product } from "@/types/product";
import type { Generation } from "@/types/generation";
import BrandQuickView from "@/components/BrandQuickView";
import JsonHierarchyView from "@/components/JsonHierarchyView";

const STATUS_BADGE: Record<PromptTemplate["status"], string> = {
  draft: "badge-sampled",
  approved: "badge-active",
  archived: "badge-retired",
};

const GEN_STATUS_BADGE: Record<Generation["status"], string> = {
  success: "badge-sampled",
  failed: "badge-retired",
  approved: "badge-active",
  rejected: "badge-retired",
};

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<PromptTemplate | null | "loading">("loading");
  const [product, setProduct] = useState<Product | null>(null);
  const [customer, setCustomer] = useState<RealCustomer | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingGenId, setDeletingGenId] = useState<string | null>(null);
  const [galleryAddingId, setGalleryAddingId] = useState<string | null>(null);
  const [galleryAddedIds, setGalleryAddedIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshGenerations() {
    setGenerations(await listGenerationsForTemplate(id));
  }

  useEffect(() => {
    getTemplate(id).then(async (t) => {
      setTemplate(t);
      if (t) {
        setProduct(await getProduct(t.productId));
        setCustomer(await getRealCustomer(t.customerId));
      }
    });
    refreshGenerations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await createGeneration(id, file);
    }
    await refreshGenerations();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleGenDelete(g: Generation) {
    const ok = window.confirm("Delete this generation? This cannot be undone.");
    if (!ok) return;
    setDeletingGenId(g.id);
    await deleteGeneration(g.id, g.resultImageUrl);
    await refreshGenerations();
    setDeletingGenId(null);
  }

  // Copies the generated image's actual bytes into the product's own
  // pd_products/{id}/ Storage folder as a real ProductImage (via the same
  // addProductImage() an ordinary upload uses) — not just re-pointing at the
  // generation's existing Storage file, which would break the product's
  // photo the moment that generation is later deleted (deleteGeneration
  // removes its Storage object). Fetched through /api/image-proxy for the
  // same cross-origin reason as the PNG export and Download link above.
  async function handleAddToGallery(g: Generation) {
    if (!product) return;
    setGalleryAddingId(g.id);
    try {
      const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(g.resultImageUrl)}`);
      const blob = await res.blob();
      const file = new File([blob], `generation-${g.id}.jpg`, { type: blob.type || "image/jpeg" });
      await addProductImage(product.id, file, {
        caption: template !== "loading" && template ? template.name : undefined,
      });
      setGalleryAddedIds((prev) => new Set(prev).add(g.id));
    } finally {
      setGalleryAddingId(null);
    }
  }

  async function handleCopy() {
    if (template === "loading" || !template) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(template.promptJson, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Couldn't copy — this browser blocked clipboard access. Select the JSON and copy manually.");
    }
  }

  async function handleDelete() {
    if (template === "loading" || !template) return;
    const ok = window.confirm(`Delete template "${template.name}"? This cannot be undone.`);
    if (!ok) return;
    setDeleting(true);
    await deleteTemplate(id);
    navigate(product ? `/design/products/${product.id}` : "/design/templates");
  }

  async function handleDuplicate() {
    setDuplicating(true);
    const newId = await duplicateTemplate(id);
    navigate(`/design/templates/${newId}/edit`);
  }

  if (template === "loading") return <main className="p-10 text-ink-60">Loading…</main>;
  if (!template) return <main className="p-10 text-ink-60">Template not found.</main>;

  const sourceImage = product?.images.find((img) => img.id === template.sourceImageId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs text-ink-60 mb-2">
        <Link to="/design/templates" className="hover:underline">Templates</Link> /{" "}
        {product && (
          <Link to={`/design/products/${product.id}`} className="hover:underline">{product.name}</Link>
        )} / {template.name}
      </p>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl">{template.name}</h1>
          <span className={`badge ${STATUS_BADGE[template.status]}`}>{template.status}</span>
        </div>
        <div className="flex gap-2">
          <Link to={`/design/templates/${id}/edit`} className="btn btn-secondary">Edit</Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDuplicate}
            disabled={duplicating}
            title="Copy this template's JSON and locked fields into a new draft version"
          >
            {duplicating ? "Duplicating…" : "Duplicate as new version"}
          </button>
          <button
            type="button"
            className="btn btn-secondary text-red-700"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      <p className="text-sm text-ink-60 mb-6">
        {product?.name} {customer && `· ${customerDisplayName(customer)}`}
      </p>

      {template.customerId && (
        <div className="mb-6">
          <BrandQuickView customerId={template.customerId} />
        </div>
      )}

      <div className="grid grid-cols-[160px_1fr] gap-6">
        <div>
          <h2 className="eyebrow mb-2">Source Image</h2>
          {sourceImage ? (
            <div className="card overflow-hidden aspect-square bg-ivory-dark flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sourceImage.url} alt="" className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <p className="text-xs text-ink-60">None linked.</p>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="eyebrow">Prompt JSON</h2>
            <button type="button" className="btn btn-secondary" onClick={handleCopy}>
              {copied ? "Copied ✓" : "Copy JSON"}
            </button>
          </div>
          {copyError && <p className="text-xs text-red-700 mb-1">{copyError}</p>}
          <JsonHierarchyView value={template.promptJson} />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        id="genUpload"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="flex items-center justify-between mt-10 mb-1">
        <h2 className="eyebrow">
          Generations{generations.length > 0 && ` (${generations.length})`}
        </h2>
        {generations.length > 0 && (
          <label htmlFor="genUpload" className="btn btn-primary cursor-pointer">
            {uploading ? "Uploading…" : "Add Generation"}
          </label>
        )}
      </div>
      <p className="text-xs text-ink-60 mb-4 max-w-md">
        Generate the actual image directly in the Gemini app using this
        JSON as the prompt (see the workflow&rsquo;s Half A), then upload
        the result here to keep it with this template&rsquo;s brand and
        customer context.
      </p>

      {generations.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">No generations yet for this template.</p>
          <label htmlFor="genUpload" className="btn btn-primary cursor-pointer">
            {uploading ? "Uploading…" : "Upload the first result"}
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {generations.map((g) => (
            <div key={g.id} className="card overflow-hidden">
              <div className="aspect-square bg-ivory-dark flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.resultImageUrl} alt="" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="p-2 flex flex-col gap-1.5">
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                  <span className={`badge ${GEN_STATUS_BADGE[g.status]}`}>{g.status}</span>
                  {/* Same image-proxy trick as SpecSheetLayout's PNG export —
                      routed through our own origin so `download` actually
                      forces a save instead of the browser just navigating to
                      a cross-origin Storage URL (download is ignored
                      cross-origin unless the response opts in). flex-wrap +
                      gap above (was justify-between, no gap) so these 4
                      items don't run together edge-to-edge on a narrow card
                      — they now wrap onto a second line instead. */}
                  <a
                    href={`/api/image-proxy?url=${encodeURIComponent(g.resultImageUrl)}`}
                    download={`${(template !== "loading" && template?.name) || "generation"}-${g.id}.jpg`}
                    className="text-2xs text-brand-600 uppercase tracking-wide hover:underline"
                  >
                    Download
                  </a>
                  {(g.status === "success" || g.status === "rejected") && (
                    <button
                      className="text-2xs text-emerald-700 uppercase tracking-wide hover:underline"
                      onClick={async () => {
                        await updateGeneration(g.id, { status: "approved" });
                        await refreshGenerations();
                      }}
                    >
                      Approve
                    </button>
                  )}
                  {(g.status === "success" || g.status === "approved") && (
                    <button
                      className="text-2xs text-red-700 uppercase tracking-wide hover:underline"
                      onClick={async () => {
                        await updateGeneration(g.id, { status: "rejected" });
                        await refreshGenerations();
                      }}
                    >
                      Reject
                    </button>
                  )}
                </div>
                {product && (
                  <button
                    type="button"
                    className="text-2xs text-ink-60 uppercase tracking-wide self-start hover:text-ink hover:underline disabled:text-ink-30 disabled:cursor-not-allowed"
                    disabled={galleryAddingId === g.id || galleryAddedIds.has(g.id)}
                    onClick={() => handleAddToGallery(g)}
                    title={`Copy this image into ${product.name}'s own photo gallery`}
                  >
                    {galleryAddingId === g.id ? "Adding…" : galleryAddedIds.has(g.id) ? "Added to gallery ✓" : "+ Add to Product Gallery"}
                  </button>
                )}
                <select
                  className="input text-2xs py-1"
                  value={g.rating ?? ""}
                  onChange={async (e) => {
                    const rating = e.target.value ? Number(e.target.value) : undefined;
                    await updateGeneration(g.id, { rating });
                    await refreshGenerations();
                  }}
                >
                  <option value="">Rate…</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} / 5</option>
                  ))}
                </select>
                <input
                  className="input text-2xs py-1"
                  placeholder="Note"
                  defaultValue={g.note || ""}
                  onBlur={async (e) => {
                    if (e.target.value !== (g.note || "")) {
                      await updateGeneration(g.id, { note: e.target.value || undefined });
                      await refreshGenerations();
                    }
                  }}
                />
                <button
                  className="text-2xs text-red-700 uppercase tracking-wide self-start hover:underline"
                  disabled={deletingGenId === g.id}
                  onClick={() => handleGenDelete(g)}
                >
                  {deletingGenId === g.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
