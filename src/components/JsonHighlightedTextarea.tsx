"use client";

import { useRef } from "react";
import { renderJsonLines } from "@/lib/jsonHighlight";

// An editable textarea with the same rainbow-bracket / key-color highlighting
// as JsonHierarchyView. A plain <textarea> can't render colored spans, so
// this uses the standard overlay trick: a highlighted <pre> sits behind a
// textarea whose own text is transparent (only its caret and selection
// paint) — same technique react-simple-code-editor uses. Both layers must
// share IDENTICAL font/padding/border/line-height or the highlight drifts
// out from under what's actually being typed, so every box-affecting class
// below is deliberately duplicated between the two rather than factored,
// to keep that fact visible at the call site.
const SHARED_BOX_CLASS =
  "font-mono text-xs leading-5 whitespace-pre-wrap break-words p-3 border box-border block w-full m-0";

export default function JsonHighlightedTextarea({
  value,
  onChange,
  onBlur,
  height = "60vh",
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  height?: string;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function syncScroll() {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }

  return (
    <div className="relative" style={{ height }}>
      <pre
        ref={preRef}
        aria-hidden
        className={`${SHARED_BOX_CLASS} absolute inset-0 overflow-hidden pointer-events-none text-ink-70 border-transparent bg-white`}
      >
        {renderJsonLines(value)}
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onBlur={onBlur}
        spellCheck={false}
        className={`${SHARED_BOX_CLASS} relative h-full overflow-auto resize-none bg-transparent text-transparent caret-ink border-line focus:outline-none focus:border-ink`}
      />
    </div>
  );
}
