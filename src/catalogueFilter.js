// Validate only after options are known; an empty successful list is authoritative.
export function catalogueFilterValue(saved, options, ready, fallback = '') {
  return !ready || saved === fallback || options.includes(saved) ? saved : fallback
}
