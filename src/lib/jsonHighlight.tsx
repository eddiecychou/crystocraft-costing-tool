import type { ReactNode } from "react";

// Shared tokenizer behind both JsonHierarchyView (read-only) and
// JsonHighlightedTextarea (editable overlay) — one definition of "what
// color is this token" so the two views can't drift apart.
export const KEY_COLOR = "var(--color-sapphire)";
export const BRACKET_COLORS = [
  "var(--color-brand-600)",
  "var(--color-bronze)",
  "var(--color-emerald-700)",
  "var(--color-amber-700)",
  "var(--color-ink-80)",
];

const KEY_LINE_RE = /^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)(.*)$/;

function renderValueSegment(text: string, depth: { current: number }, lineKey: number) {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let seg = 0;

  function flush() {
    if (buffer) {
      nodes.push(<span key={`${lineKey}-t${seg++}`}>{buffer}</span>);
      buffer = "";
    }
  }

  for (const ch of text) {
    if (ch === "{" || ch === "[") {
      flush();
      const color = BRACKET_COLORS[depth.current % BRACKET_COLORS.length];
      nodes.push(
        <span key={`${lineKey}-b${seg++}`} style={{ color }} className="font-bold">
          {ch}
        </span>,
      );
      depth.current++;
    } else if (ch === "}" || ch === "]") {
      flush();
      depth.current = Math.max(0, depth.current - 1);
      const color = BRACKET_COLORS[depth.current % BRACKET_COLORS.length];
      nodes.push(
        <span key={`${lineKey}-b${seg++}`} style={{ color }} className="font-bold">
          {ch}
        </span>,
      );
    } else {
      buffer += ch;
    }
  }
  flush();
  return nodes;
}

// Renders arbitrary JSON TEXT (not a parsed value) line by line — used by
// the editable overlay, which must tokenize whatever the owner has typed so
// far, including transiently invalid JSON, rather than a parsed object.
export function renderJsonLines(text: string): ReactNode[] {
  const lines = text.split("\n");
  const depth = { current: 0 }; // walked forward across lines during this render pass only — not persisted state
  return lines.map((line, i) => {
    const lineDepth = (line.match(/^ */)?.[0].length ?? 0) / 2;
    const keyMatch = line.match(KEY_LINE_RE);

    if (keyMatch) {
      const [, indent, key, sep, rest] = keyMatch;
      const isTopLevelKey = lineDepth === 1;
      return (
        <div key={i}>
          {indent}
          <span style={{ color: KEY_COLOR }} className={isTopLevelKey ? "font-bold" : "font-medium"}>
            {key}
          </span>
          {sep}
          {renderValueSegment(rest, depth, i)}
        </div>
      );
    }
    // A blank trailing line from split("\n") renders as an empty div, which
    // collapses to zero height — force a non-breaking space so the overlay
    // and the textarea it sits under keep the same line count and height.
    return <div key={i}>{line ? renderValueSegment(line, depth, i) : " "}</div>;
  });
}
