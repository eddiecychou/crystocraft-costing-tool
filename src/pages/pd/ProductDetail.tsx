import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useParams, useNavigate } from "react-router-dom";
import {
  getProduct,
  addProductImage,
  setBaseReferenceImage,
  updateImageCaption,
  removeProductImage,
  deleteProduct,
} from "@/lib/firestore/products";
import { getRealSupplier } from "@/lib/firestore/realSuppliers";
import { listTemplatesForProduct } from "@/lib/firestore/promptTemplates";
import { listSpecSheetsForProduct } from "@/lib/firestore/specSheetTemplates";
import { listRealCustomers } from "@/lib/firestore/realCustomers";
import type { Product } from "@/types/product";
import { supplierDisplayName, type RealSupplier } from "@/types/supplier";
import { customerDisplayName, type RealCustomer } from "@/types/customer";
import type { PromptTemplate } from "@/types/promptTemplate";
import type { SpecSheetTemplate } from "@/types/specSheetTemplate";

const STATUS_BADGE: Record<PromptTemplate["status"], string> = {
  draft: "badge-sampled",
  approved: "badge-active",
  archived: "badge-retired",
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null | "loading">("loading");
  const [supplier, setSupplier] = useState<RealSupplier | null>(null);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [specSheets, setSpecSheets] = useState<SpecSheetTemplate[]>([]);
  const [customers, setCustomers] = useState<Record<string, RealCustomer>>({});
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const p = await getProduct(id);
    setProduct(p);
    if (p) setSupplier(await getRealSupplier(p.supplierId));
    listTemplatesForProduct(id).then(setTemplates);
    listSpecSheetsForProduct(id).then(setSpecSheets);
    listRealCustomers().then((all) => setCustomers(Object.fromEntries(all.map((c) => [c.id, c]))));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    // Uploading the very first image(s) for a product: make the first one
    // the base reference by default so there's always exactly one, not
    // zero — the user can re-point it at any other image afterward.
    const isFirstUpload = product !== "loading" && product !== null && product.images.length === 0;
    const fileArr = Array.from(files);
    for (let i = 0; i < fileArr.length; i++) {
      await addProductImage(id, fileArr[i], { isBaseReference: isFirstUpload && i === 0 });
    }
    await refresh();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete() {
    if (product === "loading" || !product) return;
    const ok = window.confirm(
      `Delete "${product.name}"? This removes it and all ${product.images.length} uploaded photo(s) permanently — it cannot be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
    await deleteProduct(id);
    navigate("/design/products");
  }

  if (product === "loading") return <main className="p-10 text-ink-60">Loading…</main>;
  if (!product) return <main className="p-10 text-ink-60">Product not found.</main>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs text-ink-60 mb-2">
        <Link to="/design/products" className="hover:underline">Products</Link> /{" "}
        {supplier && (
          <Link to={`/suppliers/${supplier.id}`} className="hover:underline">
            {supplierDisplayName(supplier)}
          </Link>
        )} / {product.name}
      </p>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl">{product.name}</h1>
          <span className={`badge ${product.status === "active" ? "badge-active" : "badge-retired"}`}>
            {product.status}
          </span>
        </div>
        <div className="flex gap-2">
          <Link to={`/design/products/${id}/edit`} className="btn btn-secondary">Edit</Link>
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        id="imgUpload"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="flex items-center justify-between mb-1">
        <h2 className="eyebrow">
          Images{product.images.length > 0 && ` (${product.images.length})`}
        </h2>
        {product.images.length > 0 && (
          <label htmlFor="imgUpload" className="btn btn-primary cursor-pointer">
            {uploading ? "Uploading…" : "Add More Photos"}
          </label>
        )}
      </div>
      <p className="text-xs text-ink-60 mb-4 max-w-md">
        Add more than one where you can — different angles, colorways, or
        variations of the same product. Comparing several is what lets a
        later analysis step tell a hard design rule (always present, never
        present) apart from a one-off choice.
      </p>

      {product.images.length === 0 ? (
        <div className="card p-8 text-center mb-8">
          <p className="text-ink-70 mb-4">
            No images yet. Upload one or more reference photos from the
            supplier — different angles or variations, if you have them —
            this is what a prompt template will later be analyzed from.
          </p>
          <label htmlFor="imgUpload" className="btn btn-primary cursor-pointer">
            {uploading ? "Uploading…" : "Upload Photos"}
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-8">
          {product.images.map((img) => (
            <div key={img.id} className="card overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.caption || ""} className="w-full h-32 object-cover" />
              <div className="p-2 flex flex-col gap-1.5">
                {img.isBaseReference ? (
                  <span className="badge badge-active self-start">base reference</span>
                ) : (
                  <button
                    className="text-2xs text-ink-60 uppercase tracking-wide self-start hover:text-ink underline"
                    onClick={async () => {
                      await setBaseReferenceImage(id, img.id);
                      await refresh();
                    }}
                  >
                    Set as base reference
                  </button>
                )}
                <input
                  className="input text-2xs py-1"
                  placeholder="Caption (e.g. side view, lid open)"
                  defaultValue={img.caption || ""}
                  onBlur={async (e) => {
                    if (e.target.value !== (img.caption || "")) {
                      await updateImageCaption(id, img.id, e.target.value);
                      await refresh();
                    }
                  }}
                />
                <button
                  className="text-2xs text-red-700 uppercase tracking-wide self-start hover:underline"
                  onClick={async () => {
                    await removeProductImage(id, img.id);
                    await refresh();
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-1">
        <h2 className="eyebrow">
          Prompt Templates{templates.length > 0 && ` (${templates.length})`}
        </h2>
        {templates.length > 0 && (
          <Link to={`/design/products/${id}/templates/new`} className="btn btn-secondary">
            New Template
          </Link>
        )}
      </div>
      <p className="text-xs text-ink-60 mb-4 max-w-md">
        One template per customer/brand — pick a source image above, analyze
        it with Gemini directly, then paste the JSON here.
      </p>

      {templates.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">No templates yet for this product.</p>
          <Link to={`/design/products/${id}/templates/new`} className="btn btn-secondary">
            New Template
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <Link key={t.id} to={`/design/templates/${t.id}`} className="card flex items-center justify-between p-4 hover:border-brand-300">
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-ink-60">
                  {customers[t.customerId] ? customerDisplayName(customers[t.customerId]) : "—"}
                </p>
              </div>
              <span className={`badge ${STATUS_BADGE[t.status]}`}>{t.status}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-1 mt-10">
        <h2 className="eyebrow">
          Spec Sheets{specSheets.length > 0 && ` (${specSheets.length})`}
        </h2>
        {specSheets.length > 0 && (
          <Link to={`/design/products/${id}/spec-sheet/new`} className="btn btn-secondary">
            New Spec Sheet
          </Link>
        )}
      </div>
      <p className="text-xs text-ink-60 mb-4 max-w-md">
        A deterministic layout — product photo, dimensions, materials, price —
        rendered straight from this product&rsquo;s own data. No AI, no manual
        retouching per sheet.
      </p>

      {specSheets.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">No spec sheets yet for this product.</p>
          <Link to={`/design/products/${id}/spec-sheet/new`} className="btn btn-secondary">
            New Spec Sheet
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {specSheets.map((s) => (
            <Link key={s.id} to={`/design/spec-sheets/${s.id}`} className="card flex items-center justify-between p-4 hover:border-brand-300">
              <p className="text-sm font-medium">{s.name}</p>
              <span className="text-xs text-ink-60">{s.fields.length} field{s.fields.length === 1 ? "" : "s"}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
