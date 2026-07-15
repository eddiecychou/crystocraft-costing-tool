// Registry of customization engines. A product points at one engine via its
// `customizer_type` field; the customizer page dispatches to the matching engine
// UI, and each engine maps to a render mode in the Fly.io service.
//
// To add a new engine (e.g. surface print): add an entry here, build its
// customizer component, and add a case in CustomizerPage's dispatch.

export const CUSTOMIZER_ENGINES = {
  crystal_fabric: {
    label: 'Crystal Fabric',
    blurb: 'Customer logo rendered in crystals (Fabric / Fine Rock / Rock).',
    available: true,
  },
  surface_print: {
    label: 'Printed Graphic on Surface',
    blurb: 'Logo or graphic placed / printed on a product surface.',
    available: false,   // engine not built yet — reserved
  },
}

// Options for the admin product form (includes the "off" choice).
export const CUSTOMIZER_OPTIONS = [
  { value: '', label: 'Not customisable' },
  ...Object.entries(CUSTOMIZER_ENGINES).map(([value, e]) => ({
    value,
    label: e.available ? e.label : `${e.label} (coming soon)`,
  })),
]

// Resolve a product's engine type. Once a product has the `customizer_type`
// field it is authoritative (even when ''); legacy products fall back to the
// old `customizable: true` boolean → crystal fabric.
export function engineTypeOf(product) {
  if (product && product.customizer_type !== undefined && product.customizer_type !== null) {
    return product.customizer_type
  }
  return product?.customizable === true ? 'crystal_fabric' : ''
}

export const engineDef = type => CUSTOMIZER_ENGINES[type] || null
export const engineAvailable = type => !!CUSTOMIZER_ENGINES[type]?.available
export const engineLabel = type => CUSTOMIZER_ENGINES[type]?.label || 'Customisation'
