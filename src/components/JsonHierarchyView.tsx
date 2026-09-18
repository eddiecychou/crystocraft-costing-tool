import { renderJsonLines } from "@/lib/jsonHighlight";

// Read-only JSON display, styled like a code editor:
// - field names (keys) always render in one fixed accent color, distinct
//   from their values, so it's obvious at a glance which is which
// - {}/[] brackets are colored by nesting depth ("rainbow brackets"), so a
//   closing bracket is easy to match back to the one that opened it
// - top-level keys are additionally bold, so the JSON's overall shape reads
//   at a glance in a long template
export default function JsonHierarchyView({ value, maxHeight = "60vh" }: { value: unknown; maxHeight?: string }) {
  return (
    <div
      // min-w-0 matters here specifically: this is meant to sit in a flex/grid
      // column, and without it the column won't shrink below the content's
      // intrinsic width — a long unwrapped JSON line then pushes the whole
      // page wider instead of scrolling inside this box. whitespace-pre-wrap
      // (not whitespace-pre) is equally load-bearing: without wrapping, a
      // long value forces horizontal scroll instead of just wrapping onto
      // another line — this should only ever scroll vertically.
      className="card p-4 text-xs font-mono overflow-y-auto whitespace-pre-wrap break-words min-w-0 text-ink-70"
      style={{ maxHeight }}
    >
      {renderJsonLines(JSON.stringify(value, null, 2))}
    </div>
  );
}
