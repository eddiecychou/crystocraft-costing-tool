export function sortPackingScenarios(rows) {
  return [...rows].sort((a, b) =>
    (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0) ||
    (a.createdAt?.nanoseconds ?? 0) - (b.createdAt?.nanoseconds ?? 0) ||
    a.id.localeCompare(b.id))
}

export function resolvePackingSelection(rows, selection) {
  const id = selection?.scenario_id
  if (id && rows.some(row => row.id === id)) return { selectedId: id, needsReview: false }
  const legacy = rows.filter(row => row.selected === true)
  return {
    selectedId: (legacy[0] || rows[0])?.id ?? null,
    needsReview: rows.length > 0 && (Boolean(selection) || legacy.length > 1 ||
      (legacy.length === 0 && rows.length > 1)),
  }
}
