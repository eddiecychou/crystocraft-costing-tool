# V8.18 packing list and purchase order export units

PO PDFs already print stored units in English/Chinese. Added XLSX downloads with Qty and Unit columns, unchanged numeric prices, line amounts, adjustments, deposit/balance and supplier snapshots. Quantity summaries now group unlike units rather than combining them. Existing list-level CSV exports remain unchanged.

Packing lists assumed pcs in the editor/PDF and discarded unit when saving carton contents. Auto-packing, explicit unit selection and the save whitelist now retain units. Legacy print/editor rows recover units by order_line_id, then an unambiguous code match; legacy manual rows retain the editor's original pcs default. Conflicting code matches stay visibly unresolved rather than silently choosing a unit. PDF and XLSX show per-carton units and multiplied totals, with quantity summaries grouped by unit. Carton and pallet weight/CBM calculations remain unchanged. Packing print now offers PDF/Excel buttons instead of automatically opening a print dialog.

Ten regressions exercise the real print pages/editor, packing generator/save, and actual Excel downloads with offline Firestore fixtures. All seven units, legacy/ambiguous resolution, mixed cartons, numeric values, grouped units, carton/pallet weights/volume, supplier-cost exclusion from packing export, and English/Chinese PO pricing/adjustments/deposit are covered. No live document edits, rules, roles or access changes are required. New unit snapshots are stored only when an operator normally saves the packing list; no bulk migration.

Candidate and production verification pending.
