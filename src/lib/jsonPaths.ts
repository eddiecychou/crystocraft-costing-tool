// Dot/bracket path helpers for editing an arbitrary, unschemad prompt JSON
// as a flat list of leaf fields instead of one raw blob. A path looks like
// "palette.primary" or "motifs[2].content". These are used for the
// structured template editor's per-field lock/edit rows, and for verifying
// that a locked field really didn't move after an AI tweak or merge.

export type LeafRow = {
  path: string;
  value: string | number | boolean | null;
  section: string; // top-level key this leaf lives under, for grouping
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function joinPath(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

// Flattens an object into one row per leaf (string/number/boolean/null).
// Arrays of primitives are kept as one leaf per element; arrays of objects
// recurse into each element.
export function flattenLeaves(obj: unknown): LeafRow[] {
  const rows: LeafRow[] = [];

  function walk(value: unknown, path: string, section: string) {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, joinPath(path, i), section));
    } else if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        walk(v, joinPath(path, k), section);
      }
    } else {
      rows.push({ path, value: value as LeafRow["value"], section });
    }
  }

  if (isPlainObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      walk(value, key, key);
    }
  }
  return rows;
}

// Parses "a.b[2].c" into ["a", "b", 2, "c"].
function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    parts.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  }
  return parts;
}

export function getPath(obj: unknown, path: string): unknown {
  const parts = parsePath(path);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

// Shallow-clones a root value and walks/clones down to the parent of the
// leaf named by `parts`, so a leaf write/delete never mutates the original
// object or leaves unrelated sibling references stale.
// `create: true` (setPath) fills in missing intermediate objects/arrays as
// it walks, so applying a suggestedPath the JSON doesn't have yet (e.g. a
// Gemini extraction candidate pointing at a not-yet-existing field) creates
// the container instead of crashing. `create: false` (deletePath) leaves
// missing structure alone — deleting something that isn't there is a no-op.
function cloneToParent(
  obj: unknown,
  parts: (string | number)[],
  create: boolean,
): { root: unknown; parent: Record<string | number, unknown> | null } {
  const root: unknown = Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as object) };
  let cur: Record<string | number, unknown> = root as Record<string | number, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    let next = cur[key];
    if (next == null) {
      if (!create) return { root, parent: null };
      next = typeof parts[i + 1] === "number" ? [] : {};
    }
    const cloned = Array.isArray(next) ? [...next] : isPlainObject(next) ? { ...next } : next;
    cur[key] = cloned;
    cur = cloned as Record<string | number, unknown>;
  }
  return { root, parent: cur };
}

// Sets a value at a path, returning a new top-level object (shallow-cloned
// along the path so unrelated sibling references stay stable). Missing
// intermediate containers are created as needed.
export function setPath<T>(obj: T, path: string, newValue: unknown): T {
  const parts = parsePath(path);
  const { root, parent } = cloneToParent(obj, parts, true);
  parent![parts[parts.length - 1]] = newValue;
  return root as T;
}

// Removes the leaf at a path, returning a new top-level object. Deleting an
// array element splices it out (shifting later indices down); deleting an
// object key removes it entirely. A path that doesn't exist is a no-op.
export function deletePath<T>(obj: T, path: string): T {
  const parts = parsePath(path);
  const { root, parent } = cloneToParent(obj, parts, false);
  if (!parent) return root as T;
  const lastKey = parts[parts.length - 1];
  if (Array.isArray(parent) && typeof lastKey === "number") {
    parent.splice(lastKey, 1);
  } else {
    delete parent[lastKey];
  }
  return root as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
