import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useParams, useNavigate } from "react-router-dom";
import { collection, addDoc, doc, getDocs, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { getTemplate, deleteTemplate, duplicateTemplate } from "@/lib/firestore/promptTemplates";
import { getProduct } from "@/lib/firestore/products";
import { getRealCustomer } from "@/lib/firestore/realCustomers";
import ExistingProductPicker, { type ExistingProductOption } from "@/components/ExistingProductPicker";
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
  const [creatingProductGenId, setCreatingProductGenId] = useState<string | null>(null);
  const [createProductError, setCreateProductError] = useState("");
  const [pickerGen, setPickerGen] = useState<Generation | null>(null);
  const [addingExistingId, setAddingExistingId] = useState<string | null>(null);
  const [addExistingError, setAddExistingError] = useState("");
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

  // "+ Add to Product Gallery" used to copy the image into `product` — the
  // pd_products design-source doc this template started from — which isn't
  // a real sellable catalogue item, just Product Design's own working
  // material. Eddie, 2026-09-20: "it doesn't do anything now... it needs to
  // have a button to add new to corporate gift or figurine product." So
  // this now creates a REAL product in the `products` (Corp Gifts) or
  // `range_products` (Figurine Gifts) collection instead, seeded with this
  // generation's image, then hands off to that catalogue's own edit page —
  // ProductForm/RangeForm — for the rest (category, price, components…),
  // which this page has no business collecting.
  //
  // Corp Gift: writes the image straight into products/{id}/images the same
  // way ImageGallery's own upload does (file_url/storage_path/sort_order/
  // visibility:'internal'), then sets heroImage — see ImageGallery.jsx's
  // uploadFiles and ProductDetail.jsx's handleHeroChange for the shapes
  // this mirrors.
  async function handleCreateCorpGift(g: Generation) {
    if (template === "loading" || !template) return;
    const name = window.prompt("New Corp Gift product name:", template.name);
    if (!name || !name.trim()) return;
    setCreatingProductGenId(g.id);
    setCreateProductError("");
    try {
      const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(g.resultImageUrl)}`);
      const blob = await res.blob();

      const productRef = await addDoc(collection(db, "products"), {
        name: name.trim(), product_code: "", category: "", status: "concept",
        description: "", marketing_description: "", assembly_notes: "", videos: [],
        is_new: false, customizer_type: "", active: true, heroImage: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });

      const path = `products/${productRef.id}/images/${Date.now()}_1.jpg`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, blob, { contentType: blob.type || "image/jpeg" });
      const url = await getDownloadURL(sRef);
      await addDoc(collection(db, "products", productRef.id, "images"), {
        file_url: url, storage_path: path, file_name: `generation-${g.id}.jpg`,
        type: "hero", orientation: "square", caption: template.name,
        visibility: "internal", sort_order: 0, uploaded_at: serverTimestamp(),
      });
      await updateDoc(doc(db, "products", productRef.id), { heroImage: url });

      navigate(`/products/${productRef.id}`);
    } catch (err) {
      setCreateProductError(err instanceof Error ? err.message : "Could not create the product — please try again.");
    } finally {
      setCreatingProductGenId(null);
    }
  }

  // Figurine Gifts (range_products) are a much deeper shape than a corp
  // gift — per-variant crystal/plating fields, packing, a plating stock
  // pool — that this page has no context to fill in correctly, and a
  // generic Product Design photo doesn't map onto any single one of those
  // per-variant image slots anyway. So this hands off to RangeForm's own
  // "new" flow with the name/description prefilled via the query params it
  // already reads (see RangeForm.jsx's blankForm/searchParams) rather than
  // hand-writing a range_products doc here; Eddie attaches the photo to the
  // right variant himself once he's picked plating/crystal for it.
  function handleCreateFigurine() {
    if (template === "loading" || !template) return;
    const params = new URLSearchParams({ description: template.name });
    navigate(`/range/new?${params.toString()}`);
  }

  // Eddie, 2026-09-21: "Please also added a button to add the product design
  // image to an existing product in either figurine or corporate gift" —
  // the New Corp Gift/New Figurine actions above only cover starting a
  // brand-new catalogue entry; this covers dropping the same approved image
  // onto a product that already exists. Shares ExistingProductPicker.tsx
  // (modelled on FrontPageProductPicker.jsx's dual-collection search) so
  // one button searches both catalogues at once instead of asking which
  // catalogue first.
  //
  // Corp gift: same images-subcollection write as handleCreateCorpGift,
  // just against the picked product's existing id, and only sets heroImage
  // if it didn't already have one (an existing product's chosen hero photo
  // shouldn't be silently replaced by whatever gets added to its gallery).
  //
  // Figurine: range_products has no images subcollection — photos live in
  // the plain gallery[] array on the doc itself, and RangeForm.jsx is
  // explicit that IT is the only thing allowed to write that field (see its
  // "Add to Gallery" comment: unlike colour_images, nothing else touches
  // gallery[] from outside the form, specifically so a stale open tab's
  // Save can't silently clobber an external write). So this only uploads
  // the image to Storage, then hands off to RangeForm's own edit page via
  // addGalleryUrl/addGalleryCaption query params (added to RangeForm.jsx
  // alongside its existing new-product prefill params) — it lands in local
  // form state exactly like every other gallery edit there, and only
  // actually persists once Eddie reviews it and clicks Save Changes.
  async function handleAddToExisting(product: ExistingProductOption) {
    if (!pickerGen || template === "loading" || !template) return;
    setAddingExistingId(product.id);
    setAddExistingError("");
    try {
      const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(pickerGen.resultImageUrl)}`);
      const blob = await res.blob();

      if (product.type === "corp_gift") {
        const imagesRef = collection(db, "products", product.id, "images");
        const existingSnap = await getDocs(imagesRef);
        const path = `products/${product.id}/images/${Date.now()}_${pickerGen.id}.jpg`;
        const sRef = storageRef(storage, path);
        await uploadBytes(sRef, blob, { contentType: blob.type || "image/jpeg" });
        const url = await getDownloadURL(sRef);
        await addDoc(imagesRef, {
          file_url: url, storage_path: path, file_name: `generation-${pickerGen.id}.jpg`,
          type: "hero", orientation: "square", caption: template.name,
          visibility: "internal", sort_order: existingSnap.size, uploaded_at: serverTimestamp(),
        });
        if (existingSnap.empty) {
          await updateDoc(doc(db, "products", product.id), { heroImage: url });
        }
        setPickerGen(null);
      } else {
        const path = `range_products/${product.id}/${Date.now()}-generation-${pickerGen.id}.jpg`;
        const sRef = storageRef(storage, path);
        await uploadBytes(sRef, blob, { contentType: blob.type || "image/jpeg" });
        const url = await getDownloadURL(sRef);
        const params = new URLSearchParams({ addGalleryUrl: url, addGalleryCaption: template.name });
        setPickerGen(null);
        navigate(`/range/${product.id}?${params.toString()}`);
      }
    } catch (err) {
      setAddExistingError(err instanceof Error ? err.message : "Could not add the image — please try again.");
    } finally {
      setAddingExistingId(null);
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
    <main className="mx-auto max-w-6xl px-6 py-10">
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

      {/* Widened (was max-w-3xl / a 160px image column) and the image column
          made sticky (Eddie, 2026-09-20: "I need to see the image side by
          side... I find it very difficult to relate the parameters to the
          image") — same fix already shipped for TemplateEdit.tsx, applied
          here too since this read-only JSON view can be just as long. */}
      <div className="grid grid-cols-[280px_1fr] gap-6 items-start">
        <div className="sticky top-6 self-start">
          <h2 className="eyebrow mb-2">Source Image</h2>
          {sourceImage ? (
            <>
              <div className="card overflow-hidden aspect-square bg-ivory-dark flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceImage.url} alt="" className="max-w-full max-h-full object-contain" />
              </div>
              {/* Same image-proxy trick as the generation Download link below
                  — routed through our own origin so `download` actually
                  forces a save instead of navigating to the cross-origin
                  Storage URL. Eddie, 2026-09-20: needs this alongside the
                  copied JSON to feed both into Gemini as reference. */}
              <a
                href={`/api/image-proxy?url=${encodeURIComponent(sourceImage.url)}`}
                download={`${(template !== "loading" && template?.name) || "source-image"}.jpg`}
                className="block mt-1.5 text-2xs text-brand-600 uppercase tracking-wide hover:underline"
              >
                Download
              </a>
            </>
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

      {/* Read-only view of the Reference Images uploaded on the Edit page
          (V8.16) — persisted on the template doc now (not just in-editor
          state), so they're still visible here right after Save Changes
          navigates to this page, not just the next time Edit is opened.
          Upload/Extract/Replace/Remove only make sense in edit mode. */}
      {template.referenceImages && template.referenceImages.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="eyebrow">Reference Images ({template.referenceImages.length})</h2>
            <Link to={`/design/templates/${id}/edit`} className="text-xs text-brand-600 hover:underline">Manage →</Link>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {template.referenceImages.map((r) => (
              <div key={r.id} className="card overflow-hidden">
                <div className="aspect-square bg-ivory-dark flex items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="max-w-full max-h-full object-contain" />
                </div>
                <a
                  href={`/api/image-proxy?url=${encodeURIComponent(r.url)}`}
                  download={r.name}
                  className="block p-1.5 text-2xs text-brand-600 uppercase tracking-wide hover:underline"
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

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
      {createProductError && <p className="text-xs text-red-700 mb-4">{createProductError}</p>}

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
                {(g.status === "success" || g.status === "approved") && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-2xs text-ink-60 uppercase tracking-wide self-start hover:text-ink hover:underline disabled:text-ink-30 disabled:cursor-not-allowed"
                      disabled={creatingProductGenId === g.id}
                      onClick={() => handleCreateCorpGift(g)}
                      title="Create a new Corp Gift catalogue product seeded with this image"
                    >
                      {creatingProductGenId === g.id ? "Creating…" : "+ New Corp Gift"}
                    </button>
                    <button
                      type="button"
                      className="text-2xs text-ink-60 uppercase tracking-wide self-start hover:text-ink hover:underline"
                      onClick={handleCreateFigurine}
                      title="Start a new Figurine Gift product — you'll attach the photo there once plating/crystal are picked"
                    >
                      + New Figurine
                    </button>
                    <button
                      type="button"
                      className="text-2xs text-ink-60 uppercase tracking-wide self-start hover:text-ink hover:underline"
                      onClick={() => setPickerGen(g)}
                      title="Add this image to a product that already exists"
                    >
                      + Add to Existing
                    </button>
                  </div>
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

      {pickerGen && (
        <ExistingProductPicker
          onClose={() => (addingExistingId ? null : setPickerGen(null))}
          onSelect={handleAddToExisting}
          busyId={addingExistingId}
          error={addExistingError}
        />
      )}
    </main>
  );
}
