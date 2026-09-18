import { useEffect, useState, type FormEvent, Suspense } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { authHeader } from "@/firebase";
import { getProduct, saveImageAnalysis } from "@/lib/firestore/products";
import { createTemplate } from "@/lib/firestore/promptTemplates";
import { listRealCustomers } from "@/lib/firestore/realCustomers";
import { getCustomerBrand } from "@/lib/firestore/customerBrands";
import { customerDisplayName, type RealCustomer } from "@/types/customer";
import type { Product } from "@/types/product";

function NewTemplateForm() {
  const { id: productId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedCustomerId = searchParams.get("customerId") || "";

  const [product, setProduct] = useState<Product | null | "loading">("loading");
  const [customers, setCustomers] = useState<RealCustomer[]>([]);
  const [customerId, setCustomerId] = useState(preselectedCustomerId);
  const [sourceImageId, setSourceImageId] = useState("");
  const [name, setName] = useState("");
  const [promptJsonText, setPromptJsonText] = useState("{\n  \n}");
  const [jsonError, setJsonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [hasBrandProfile, setHasBrandProfile] = useState<boolean | "loading">("loading");
  const [applyingBrand, setApplyingBrand] = useState(false);
  const [applyError, setApplyError] = useState("");

  const [tweakInstruction, setTweakInstruction] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [tweakError, setTweakError] = useState("");
  const [previousJsonText, setPreviousJsonText] = useState<string | null>(null);

  async function refreshProduct() {
    const p = await getProduct(productId);
    setProduct(p);
    return p;
  }

  useEffect(() => {
    refreshProduct().then((p) => {
      if (p?.images?.length) {
        const base = p.images.find((img) => img.isBaseReference) || p.images[0];
        setSourceImageId(base.id);
      }
    });
    listRealCustomers().then(setCustomers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    if (product && product !== "loading" && customerId) {
      const c = customers.find((x) => x.id === customerId);
      if (c && !name) {
        setName(`${product.name} — ${customerDisplayName(c)} — v1`);
      }
    }
    if (customerId) {
      setHasBrandProfile("loading");
      getCustomerBrand(customerId).then((b) => setHasBrandProfile(!!b));
    } else {
      setHasBrandProfile(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, customers]);

  const sourceImage =
    product && product !== "loading" ? product.images.find((img) => img.id === sourceImageId) : null;

  async function handleAnalyze() {
    if (!sourceImage) return;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const res = await fetch("/api/pd-analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ imageUrl: sourceImage.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      await saveImageAnalysis(productId, sourceImage.id, data.analysisJson);
      await refreshProduct();
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApplyBrand() {
    if (!sourceImage?.analysisJson || !customerId) return;
    setApplyingBrand(true);
    setApplyError("");
    try {
      const brand = await getCustomerBrand(customerId);
      if (!brand) throw new Error("No brand profile for this customer yet.");
      const res = await fetch("/api/pd-apply-brand", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ baseJson: sourceImage.analysisJson, brandJson: brand.brandJson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply Brand failed");
      setPromptJsonText(JSON.stringify(data.resultJson, null, 2));
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Apply Brand failed");
    } finally {
      setApplyingBrand(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(promptJsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setJsonError("Couldn't copy — this browser blocked clipboard access. Select the JSON and copy manually.");
    }
  }

  async function handleTweak() {
    if (!tweakInstruction.trim()) return;
    let currentJson: unknown;
    try {
      currentJson = JSON.parse(promptJsonText);
    } catch {
      setTweakError("Fix the JSON error below first — can't tweak invalid JSON.");
      return;
    }
    setTweaking(true);
    setTweakError("");
    try {
      const res = await fetch("/api/pd-tweak-json", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ currentJson, instruction: tweakInstruction.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tweak failed");
      setPreviousJsonText(promptJsonText);
      setPromptJsonText(JSON.stringify(data.resultJson, null, 2));
      setTweakInstruction("");
    } catch (e) {
      setTweakError(e instanceof Error ? e.message : "Tweak failed");
    } finally {
      setTweaking(false);
    }
  }

  function undoTweak() {
    if (previousJsonText === null) return;
    setPromptJsonText(previousJsonText);
    setPreviousJsonText(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (product === "loading" || !product) return;
    let promptJson: Record<string, unknown>;
    try {
      promptJson = JSON.parse(promptJsonText);
    } catch {
      setJsonError("That's not valid JSON — check for a missing comma or bracket.");
      return;
    }
    setJsonError("");
    setBusy(true);
    const id = await createTemplate({
      name,
      type: "base",
      productId: product.id,
      supplierId: product.supplierId,
      customerId,
      sourceImageId: sourceImageId || undefined,
      promptJson,
      tags: [],
      status: "draft",
    });
    navigate(`/design/templates/${id}`);
  }

  if (product === "loading") return <main className="p-10 text-ink-60">Loading…</main>;
  if (!product) return <main className="p-10 text-ink-60">Product not found.</main>;

  if (product.images.length === 0) {
    return (
      <main className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-2xl mb-4">New Template</h1>
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">
            {product.name} has no reference photos yet. A template always
            starts from one — upload a photo on the product page first.
          </p>
          <Link to={`/design/products/${productId}`} className="btn btn-primary">
            Go to {product.name}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl mb-1">New Template</h1>
      <p className="text-xs text-ink-60 mb-6">for {product.name}.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="card p-6 flex flex-col gap-4 max-w-lg">
          <div>
            <label className="label" htmlFor="sourceImage">Source Image</label>
            <select
              id="sourceImage"
              className="input"
              value={sourceImageId}
              onChange={(e) => setSourceImageId(e.target.value)}
            >
              {product.images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.caption || img.id.slice(0, 8)}{img.isBaseReference ? " (base reference)" : ""}
                  {img.analysisJson ? " — analyzed" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="customer">Customer</label>
            <select
              id="customer"
              className="input"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            >
              <option value="" disabled>Choose a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{customerDisplayName(c)}</option>
              ))}
            </select>
            <p className="text-xs text-ink-60 mt-1">
              Pulled from the costing-tool app&rsquo;s CRM — to add a customer
              that isn&rsquo;t listed, add it there first.
            </p>
            {customerId && (
              <p className="text-xs mt-1">
                {hasBrandProfile === "loading" ? (
                  "Checking brand profile…"
                ) : hasBrandProfile ? (
                  <Link to={`/design/customers/${customerId}/brand`} className="underline text-ink-60">
                    Edit brand profile
                  </Link>
                ) : (
                  <Link to={`/design/customers/${customerId}/brand`} className="underline text-brand-600">
                    No brand profile yet — create one
                  </Link>
                )}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="eyebrow">Base Analysis (read-only)</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAnalyze}
                disabled={analyzing || !sourceImage}
              >
                {analyzing ? "Analyzing…" : sourceImage?.analysisJson ? "Re-analyze" : "Analyze with Gemini"}
              </button>
            </div>
            {analyzeError && <p className="text-xs text-red-700 mb-2">{analyzeError}</p>}
            {sourceImage?.analysisJson ? (
              <pre className="card p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                {JSON.stringify(sourceImage.analysisJson, null, 2)}
              </pre>
            ) : (
              <div className="card p-8 text-center">
                <p className="text-ink-70 text-sm">
                  Not analyzed yet — click &ldquo;Analyze with Gemini&rdquo; to
                  get a structured description of this photo, or skip this
                  and paste JSON directly on the right.
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="eyebrow">Final Prompt JSON (editable)</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleApplyBrand}
                  disabled={applyingBrand || !sourceImage?.analysisJson || !hasBrandProfile}
                  title={
                    !sourceImage?.analysisJson
                      ? "Analyze the source image first"
                      : !hasBrandProfile
                        ? "This customer has no brand profile yet"
                        : ""
                  }
                >
                  {applyingBrand ? "Applying…" : "Apply Brand →"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleCopy}>
                  {copied ? "Copied ✓" : "Copy JSON"}
                </button>
              </div>
            </div>
            {applyError && <p className="text-xs text-red-700 mb-2">{applyError}</p>}
            <textarea
              id="promptJson"
              className="input font-mono text-xs"
              rows={20}
              value={promptJsonText}
              onChange={(e) => setPromptJsonText(e.target.value)}
            />
            {jsonError && <p className="text-xs text-red-700 mt-1">{jsonError}</p>}
            <p className="text-xs text-ink-60 mt-1 mb-3">
              This is your checkpoint — compare against the base analysis on
              the left, edit anything, then copy it out to generate in the
              Gemini app whenever you&rsquo;re ready. Saving here just keeps
              the record; it doesn&rsquo;t generate anything.
            </p>

            <div className="card p-3 bg-ivory-mid">
              <label className="label" htmlFor="tweak">Tweak with AI</label>
              <p className="text-xs text-ink-60 mb-2">
                One specific change at a time — &ldquo;move the reserved logo
                area to the top-right and shrink it 20%,&rdquo; not &ldquo;make
                the logo better.&rdquo; Everything else stays untouched.
              </p>
              <div className="flex gap-2">
                <input
                  id="tweak"
                  className="input flex-1"
                  value={tweakInstruction}
                  onChange={(e) => setTweakInstruction(e.target.value)}
                  placeholder="e.g. increase composition_density to 60%"
                />
                <button type="button" className="btn btn-secondary" onClick={handleTweak} disabled={tweaking || !tweakInstruction.trim()}>
                  {tweaking ? "Tweaking…" : "Apply Tweak"}
                </button>
                {previousJsonText !== null && (
                  <button type="button" className="btn btn-secondary" onClick={undoTweak}>
                    Undo
                  </button>
                )}
              </div>
              {tweakError && <p className="text-xs text-red-700 mt-2">{tweakError}</p>}
            </div>
          </div>
        </div>

        <button type="submit" className="btn btn-primary self-start" disabled={busy || !name || !customerId}>
          {busy ? "Saving…" : "Save Template"}
        </button>
      </form>
    </main>
  );
}

export default function NewTemplatePage() {
  return (
    <Suspense fallback={<main className="p-10 text-ink-60">Loading…</main>}>
      <NewTemplateForm />
    </Suspense>
  );
}
