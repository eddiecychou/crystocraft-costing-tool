import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { authHeader } from "@/firebase";
import { getTemplate, updateTemplate } from "@/lib/firestore/promptTemplates";
import { listRealCustomers } from "@/lib/firestore/realCustomers";
import { customerDisplayName, type RealCustomer } from "@/types/customer";
import type { PromptTemplate } from "@/types/promptTemplate";
import { flattenLeaves, getPath, setPath, deletePath, type LeafRow } from "@/lib/jsonPaths";
import { storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import BrandQuickView from "@/components/BrandQuickView";
import JsonHighlightedTextarea from "@/components/JsonHighlightedTextarea";

type Candidate = {
  label: string;
  value: string;
  suggestedPath: string;
  kind: "color" | "motif" | "style" | "material" | "composition" | "other" | "reserved_area";
};

function coerceLikeOriginal(original: unknown, raw: string): unknown {
  if (typeof original === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (typeof original === "boolean") return raw === "true";
  return raw;
}

export default function EditTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<PromptTemplate | null | "loading">("loading");
  const [customers, setCustomers] = useState<RealCustomer[]>([]);
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState<PromptTemplate["status"]>("draft");
  const [tags, setTags] = useState("");
  const [promptJson, setPromptJson] = useState<Record<string, unknown>>({});
  const [lockedPaths, setLockedPaths] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [rawText, setRawText] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [rawError, setRawError] = useState("");

  const [tweakInstruction, setTweakInstruction] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [tweakError, setTweakError] = useState("");
  const [tweakNote, setTweakNote] = useState("");
  const [previousJson, setPreviousJson] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [appliedIdx, setAppliedIdx] = useState<Set<number>>(new Set());

  useEffect(() => {
    getTemplate(id).then((t) => {
      setTemplate(t);
      if (t) {
        setName(t.name);
        setCustomerId(t.customerId);
        setStatus(t.status);
        setTags(t.tags.join(", "));
        setPromptJson(t.promptJson);
        setRawText(JSON.stringify(t.promptJson, null, 2));
        setLockedPaths(new Set(t.lockedPaths || []));
      }
    });
    listRealCustomers().then(setCustomers);
  }, [id]);

  const rows = useMemo(() => flattenLeaves(promptJson), [promptJson]);
  const sections = useMemo(() => {
    const map = new Map<string, LeafRow[]>();
    for (const row of rows) {
      if (!map.has(row.section)) map.set(row.section, []);
      map.get(row.section)!.push(row);
    }
    return map;
  }, [rows]);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [highlightPath, setHighlightPath] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightPath) return;
    const el = rowRefs.current.get(highlightPath);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightPath(null), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightPath, rows]);

  function toggleLock(path: string) {
    setLockedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function editLeaf(path: string, raw: string) {
    const original = getPath(promptJson, path);
    const updated = setPath(promptJson, path, coerceLikeOriginal(original, raw));
    setPromptJson(updated);
    setRawText(JSON.stringify(updated, null, 2));
  }

  function deleteLeaf(path: string) {
    const updated = deletePath(promptJson, path);
    setPromptJson(updated);
    setRawText(JSON.stringify(updated, null, 2));
    setLockedPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  // Key typed per-section in the "+ Add field" row below its existing fields —
  // plain "theme" for a new field, or "materials[4]" to append an array item
  // (setPath's own path parser already handles both, same as any edited leaf).
  const [newFieldKeys, setNewFieldKeys] = useState<Record<string, string>>({});

  function addField(section: string) {
    const key = (newFieldKeys[section] || "").trim();
    if (!key) return;
    const path = `${section}.${key}`;
    if (getPath(promptJson, path) !== undefined) {
      window.alert(`"${path}" already exists.`);
      return;
    }
    const updated = setPath(promptJson, path, "");
    setPromptJson(updated);
    setRawText(JSON.stringify(updated, null, 2));
    setNewFieldKeys((prev) => ({ ...prev, [section]: "" }));
    setHighlightPath(path);
  }

  // Recursively blanks every leaf to "" while keeping the container shape —
  // used to seed a new array item (below) so it arrives with the same
  // editable sub-fields as its siblings instead of an empty {} that would
  // render zero rows (flattenLeaves skips empty objects/arrays entirely).
  function blankLeaves(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(blankLeaves);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = blankLeaves(v);
      return out;
    }
    return "";
  }

  // When the SECTION ITSELF is a JSON array (e.g. reserved_areas — several
  // sections here are objects of scalar leaves, but this one is a list of
  // {label, bbox, note} entries), "+ Add field" can't just join
  // `${section}.${key}` — that sets a plain object property on the array,
  // which JSON.stringify silently drops (arrays only serialize their index
  // entries), so the field would vanish with no error. Appending a new
  // element (shaped like the last one, blanked) is the correct "add" for an
  // array section instead.
  function addArrayItem(section: string) {
    const arr = promptJson[section];
    if (!Array.isArray(arr)) return;
    const template = arr.length > 0 ? blankLeaves(arr[arr.length - 1]) : {};
    const updated = { ...promptJson, [section]: [...arr, template] };
    setPromptJson(updated);
    setRawText(JSON.stringify(updated, null, 2));
    if (arr.length > 0) setHighlightPath(`${section}[${arr.length}]`);
  }

  function applyRawText() {
    try {
      const parsed = JSON.parse(rawText);
      setPromptJson(parsed);
      setRawError("");
    } catch {
      setRawError("That's not valid JSON — check for a missing comma or bracket. Structured view still reflects the last valid version.");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (rawMode) applyRawText();
    setBusy(true);
    await updateTemplate(id, {
      name,
      customerId,
      status,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      promptJson,
      lockedPaths: Array.from(lockedPaths),
    });
    navigate(`/design/templates/${id}`);
  }

  async function handleTweak() {
    if (!tweakInstruction.trim()) return;
    setTweaking(true);
    setTweakError("");
    setTweakNote("");
    try {
      const res = await fetch("/api/pd-tweak-json", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          currentJson: promptJson,
          instruction: tweakInstruction.trim(),
          lockedPaths: Array.from(lockedPaths),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tweak failed");
      setPreviousJson(promptJson);
      setPromptJson(data.resultJson);
      setRawText(JSON.stringify(data.resultJson, null, 2));
      setTweakInstruction("");
      if (data.restoredCount > 0) {
        setTweakNote(`${data.restoredCount} locked field${data.restoredCount === 1 ? "" : "s"} drifted and ${data.restoredCount === 1 ? "was" : "were"} restored.`);
      }
    } catch (e) {
      setTweakError(e instanceof Error ? e.message : "Tweak failed");
    } finally {
      setTweaking(false);
    }
  }

  function undoTweak() {
    if (!previousJson) return;
    setPromptJson(previousJson);
    setRawText(JSON.stringify(previousJson, null, 2));
    setPreviousJson(null);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(promptJson, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setRawError("Couldn't copy — this browser blocked clipboard access. Select the JSON and copy manually.");
    }
  }

  async function handleExtractFile(file: File | null) {
    if (!file) return;
    setExtracting(true);
    setExtractError("");
    setCandidates(null);
    setAppliedIdx(new Set());
    try {
      const scratchRef = ref(storage, `pd_extraction_scratch/${id}/${crypto.randomUUID()}-${file.name}`);
      await uploadBytes(scratchRef, file);
      const imageUrl = await getDownloadURL(scratchRef);
      const res = await fetch("/api/pd-extract-elements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ imageUrl, currentJson: promptJson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setCandidates(data.candidates);
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  function applyCandidate(c: Candidate, idx: number) {
    let updated: Record<string, unknown>;
    let landedPath: string;
    if (c.kind === "reserved_area") {
      const existing = (getPath(promptJson, "reserved_areas") as unknown[]) || [];
      updated = setPath(promptJson, "reserved_areas", [...existing, { label: c.label, note: c.value }]);
      landedPath = `reserved_areas[${existing.length}]`;
    } else if (c.suggestedPath.endsWith("[]")) {
      // Gemini uses a trailing "[]" to mean "append to this array," not a
      // literal path — setPath alone would strip it and overwrite the whole
      // array with the new scalar.
      const basePath = c.suggestedPath.slice(0, -2);
      const existing = (getPath(promptJson, basePath) as unknown[]) || [];
      updated = setPath(promptJson, basePath, [...existing, c.value]);
      landedPath = `${basePath}[${existing.length}]`;
    } else {
      updated = setPath(promptJson, c.suggestedPath, c.value);
      landedPath = c.suggestedPath;
    }
    setPromptJson(updated);
    setRawText(JSON.stringify(updated, null, 2));
    setAppliedIdx((prev) => new Set(prev).add(idx));
    // Applied fields can land in an existing section far down the page, or
    // even a brand-new section at the very bottom — surface exactly where
    // it went instead of leaving the owner to hunt for it.
    setRawMode(false);
    setHighlightPath(landedPath);
  }

  if (template === "loading") return <main className="p-10 text-ink-60">Loading…</main>;
  if (!template) return <main className="p-10 text-ink-60">Template not found.</main>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl mb-6">Edit Template</h1>
      <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
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
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select
            id="status"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as PromptTemplate["status"])}
          >
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tags">Tags (comma-separated)</label>
          <input id="tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>

        {customerId && <BrandQuickView customerId={customerId} />}

        {/* i) Structured, lockable field editor */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Prompt JSON</label>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={handleCopy}>
                {copied ? "Copied ✓" : "Copy JSON"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (!rawMode) setRawText(JSON.stringify(promptJson, null, 2));
                  else applyRawText();
                  setRawMode((v) => !v);
                }}
              >
                {rawMode ? "Back to fields" : "Edit raw JSON"}
              </button>
            </div>
          </div>
          <p className="text-xs text-ink-60 mb-2">
            Lock a field to pin it — locked fields are never touched by an AI
            tweak, an AI merge, or an applied extraction. Everything else is
            open for AI to play with.
          </p>

          {rawMode ? (
            <div>
              <JsonHighlightedTextarea value={rawText} onChange={setRawText} onBlur={applyRawText} />
              {rawError && <p className="text-xs text-red-700 mt-1">{rawError}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3 overflow-y-auto pr-1" style={{ maxHeight: "60vh" }}>
              {Array.from(sections.entries()).map(([section, leaves]) => {
                const sectionValue = promptJson[section];
                const isArraySection = Array.isArray(sectionValue) && sectionValue.length > 0;
                return (
                <div key={section} className="border border-line rounded p-3">
                  <p className="text-2xs uppercase tracking-wide text-ink-60 mb-2">{section}</p>
                  <div className="flex flex-col gap-1.5">
                    {leaves.map((row) => {
                      const locked = lockedPaths.has(row.path);
                      // The section header already names the top-level key —
                      // drop it (and one leading separator) from the row label
                      // so long paths like reserved_areas[0].bbox.width don't
                      // get truncated to nothing.
                      const shortLabel = row.path.slice(row.section.length).replace(/^[.[]/, (m) => (m === "[" ? "[" : ""));
                      const highlighted = highlightPath === row.path;
                      return (
                        <div
                          key={row.path}
                          ref={(el) => {
                            if (el) rowRefs.current.set(row.path, el);
                            else rowRefs.current.delete(row.path);
                          }}
                          className={`flex items-center gap-2 rounded px-1.5 py-1 -mx-1.5 transition-colors duration-500 ${
                            highlighted ? "bg-emerald-100 ring-1 ring-emerald-400" : locked ? "bg-amber-50" : ""
                          }`}
                        >
                          <button
                            type="button"
                            title={locked ? "Locked — click to unlock" : "Click to lock this field"}
                            className={`flex items-center gap-1 text-2xs font-medium shrink-0 rounded-full px-2 py-0.5 border ${
                              locked
                                ? "bg-amber-100 border-amber-300 text-amber-800"
                                : "bg-transparent border-line text-ink-40 hover:border-ink-30 hover:text-ink-60"
                            }`}
                            onClick={() => toggleLock(row.path)}
                          >
                            {locked ? "🔒 Locked" : "🔓 Open"}
                          </button>
                          <span
                            className="text-2xs text-ink-60 font-mono w-32 shrink-0 break-words leading-tight"
                            title={row.path}
                          >
                            {shortLabel || row.path}
                          </span>
                          <input
                            className="input text-xs py-1 flex-1 min-w-0"
                            value={String(row.value ?? "")}
                            disabled={locked}
                            onChange={(e) => editLeaf(row.path, e.target.value)}
                          />
                          <button
                            type="button"
                            title={locked ? "Unlock before deleting" : "Delete this field"}
                            className="text-xs shrink-0 text-red-700 disabled:text-ink-30 disabled:cursor-not-allowed"
                            disabled={locked}
                            onClick={() => {
                              if (window.confirm(`Delete "${row.path}"?`)) deleteLeaf(row.path);
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      );
                    })}
                    {isArraySection ? (
                      // Array section (e.g. reserved_areas) — "add" means a new
                      // list item, shaped like the last one so it arrives with
                      // real editable sub-fields, not a free-text path.
                      <button
                        type="button"
                        className="self-start text-2xs font-medium shrink-0 rounded-full px-2 py-0.5 border border-line text-ink-60 hover:border-ink-30 hover:text-ink mt-1 pt-1 border-t"
                        onClick={() => addArrayItem(section)}
                      >
                        + Add item (like the last one)
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 pt-1 mt-1 border-t border-line">
                        <input
                          className="input text-xs py-1 flex-1 min-w-0"
                          placeholder="e.g. new_field or materials[4]"
                          value={newFieldKeys[section] || ""}
                          onChange={(e) => setNewFieldKeys((prev) => ({ ...prev, [section]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); addField(section); }
                          }}
                        />
                        <button
                          type="button"
                          className="text-2xs font-medium shrink-0 rounded-full px-2 py-0.5 border border-line text-ink-60 hover:border-ink-30 hover:text-ink disabled:text-ink-30 disabled:cursor-not-allowed"
                          disabled={!(newFieldKeys[section] || "").trim()}
                          onClick={() => addField(section)}
                        >
                          + Add field
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              {rows.length === 0 && <p className="text-xs text-ink-60">No fields yet.</p>}
            </div>
          )}
        </div>

        {/* iii) Extract elements from an image, click to apply into open fields */}
        <div className="card p-4 bg-ivory-mid">
          <label className="label">Extract Elements From Image</label>
          <p className="text-xs text-ink-60 mb-2">
            Upload a reference photo — Gemini pulls out colors, motifs, style
            and material candidates and suggests where each fits in the JSON
            above. Nothing is applied until you click one. Logos/on-object
            text never come back as drawable content — only as a suggested
            reserved area.
          </p>
          <input
            type="file"
            accept="image/*"
            className="text-xs"
            onChange={(e) => handleExtractFile(e.target.files?.[0] || null)}
            disabled={extracting}
          />
          {extracting && <p className="text-xs text-ink-60 mt-2">Analyzing…</p>}
          {extractError && <p className="text-xs text-red-700 mt-2">{extractError}</p>}
          {candidates && candidates.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-3">
              {candidates.map((c, idx) => {
                const applied = appliedIdx.has(idx);
                const targetLocked = c.kind !== "reserved_area" && lockedPaths.has(c.suggestedPath);
                return (
                  <div key={idx} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs border border-line rounded px-2 py-1.5">
                    <span className="badge badge-sampled shrink-0">{c.kind}</span>
                    <span className="font-medium shrink-0">{c.label}:</span>
                    <span className="text-ink-70 truncate max-w-full" title={c.value}>{c.value}</span>
                    {c.kind !== "reserved_area" && (
                      <span className="text-2xs text-ink-60 font-mono truncate max-w-full basis-full sm:basis-auto sm:flex-1 min-w-0" title={c.suggestedPath}>
                        → {c.suggestedPath}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary shrink-0 ml-auto"
                      disabled={applied || targetLocked}
                      title={targetLocked ? "Target field is locked" : undefined}
                      onClick={() => applyCandidate(c, idx)}
                    >
                      {applied ? "Applied ✓" : targetLocked ? "Locked" : "Apply"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {candidates && candidates.length === 0 && (
            <p className="text-xs text-ink-60 mt-2">No candidate elements found in that image.</p>
          )}
        </div>

        {/* ii) AI merge/tweak, respecting locks */}
        <div className="card p-4 bg-ivory-mid">
          <label className="label" htmlFor="tweak">Tweak with AI</label>
          <p className="text-xs text-ink-60 mb-2">
            Describe one specific change — the Coordinate Correction method:
            &ldquo;move the reserved logo area to the top-right and shrink
            it 20%,&rdquo; not &ldquo;make the logo better.&rdquo; Locked
            fields (🔒 above) are pinned and won&rsquo;t move even if the
            instruction implies it.
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
            {previousJson !== null && (
              <button type="button" className="btn btn-secondary" onClick={undoTweak}>
                Undo
              </button>
            )}
          </div>
          {tweakError && <p className="text-xs text-red-700 mt-2">{tweakError}</p>}
          {tweakNote && <p className="text-xs text-amber-700 mt-2">{tweakNote}</p>}
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy || !name || !customerId}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
          <Link to={`/design/templates/${id}`} className="btn btn-secondary">Cancel</Link>
        </div>
      </form>
    </main>
  );
}
