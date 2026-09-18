import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useParams, useNavigate } from "react-router-dom";
import { getTemplate, deleteTemplate } from "@/lib/firestore/promptTemplates";
import { getProduct } from "@/lib/firestore/products";
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
  const [uploading, setUploading] = useState(false);
  const [deletingGenId, setDeletingGenId] = useState<string | null>(null);
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
            <div className="card overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sourceImage.url} alt="" className="w-full h-40 object-cover" />
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.resultImageUrl} alt="" className="w-full h-32 object-cover" />
              <div className="p-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className={`badge ${GEN_STATUS_BADGE[g.status]}`}>{g.status}</span>
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
