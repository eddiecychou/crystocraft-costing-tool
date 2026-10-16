import { RANGE_UPLOAD_UID } from '../src/domain/rangeUpload.js'
export const SERVICE = { uid: RANGE_UPLOAD_UID, range_upload: true }
export const OWNER = { uid: 'range-owner-admin' }
export const coach = () => ({ mode: 'create', dry_run: true,
  family: { design_no: '0606', format_code: '001', design_name: 'Large Crystal Coach', description: 'Crystal coach with gold finish. Confirmed overall dimensions from owner correction.', marketing_description: 'A crystal coach for memorable celebrations.', product_type: 'Figurine', design_type: 'Fairytale', dimensions: { length: 106.8, width: 61.5, height: 85.6, unit: 'mm', overall_confirmed: true } },
  category_confirmations: ['design_type:Fairytale'],
  variants: [{ brand_code: 'D', plating_code: 'G', crystal_colors: ['C1'] }],
  components: [
    { create: { code: 'FM-U0606PT00-01G', name: 'Coach frame', category: 'Metal Part', plating_code: 'G' }, qty_per_unit: 1, applicability: 'auto', critical_reason: 'tooling' },
    { component_id: 'globe', code: 'FM-GLB-H(G)', qty_per_unit: 1, applicability: 'auto', critical_reason: 'supply_risk' },
    { component_id: 'crown', code: 'FM-U0227PT01-G', qty_per_unit: 1, applicability: 'G', critical_reason: 'supply_risk' },
  ],
})
export const contextFixture = () => ({ products: [], components: [
  { id: 'globe', version: 'g1', data: { code: 'FM-GLB-H(G)', name: 'Large globe', category: 'Metal Part', plating_code: 'G', unit_cost: 999, preferred_supplier_name: 'PRIVATE' } },
  { id: 'crown', version: 'c1', data: { code: 'FM-U0227PT01-G', name: 'Crown', category: 'Metal Part', plating_code: 'G' } },
  { id: 'shared', version: 's1', data: { code: 'SHARED-BASE', name: 'Shared base', category: 'Base / Stand', plating_code: '' } },
], colors: [{ code: 'C1', name: 'Clear' }, { code: 'BL', name: 'Sapphire' }, { code: 'RE', name: 'Ruby' }], componentCategories: ['Metal Part','Base / Stand'], storageBuckets: ['crystocraft-costing.firebasestorage.app'] })
