# V8.18 packing list and purchase order export units

PO PDFs already print stored units in English/Chinese. Added XLSX downloads with Qty and Unit columns, unchanged numeric prices, line amounts, adjustments, deposit/balance and supplier snapshots. Quantity summaries now group unlike units rather than combining them. Existing list-level CSV exports remain unchanged.

Packing lists assumed pcs in the editor/PDF and discarded unit when saving carton contents. Auto-packing, explicit unit selection and the save whitelist now retain units. Legacy print/editor rows recover units by order_line_id, then an unambiguous code match; legacy manual rows retain the editor's original pcs default. Conflicting code matches stay visibly unresolved rather than silently choosing a unit. PDF and XLSX show per-carton units and multiplied totals, with quantity summaries grouped by unit. Carton and pallet weight/CBM calculations remain unchanged. Packing print now offers PDF/Excel buttons instead of automatically opening a print dialog.

Ten regressions exercise the real print pages/editor, packing generator/save, and actual Excel downloads with offline Firestore fixtures. All seven units, legacy/ambiguous resolution, mixed cartons, numeric values, grouped units, carton/pallet weights/volume, supplier-cost exclusion from packing export, and English/Chinese PO pricing/adjustments/deposit are covered. No live document edits, rules, roles or access changes are required. New unit snapshots are stored only when an operator normally saves the packing list; no bulk migration.

Candidate and production verification pending.

## Candidate PASS — 15 October 2026

Code `e76b132`, deploy `6ad0c6e902e0792fda6180ba`, https://6ad0c6e902e0792fda6180ba--ua-product-manager.netlify.app. Served `/assets/index-DNLuWiUY.js`, V8.18 ·15Oct23:28; configuration probe200. All70 regressions, production build/lint and11configuration checks PASS. Synthetic real-component HTML/XLSX fixtures rendered and text-checked for units; browser viewport screenshots inspected for print CSS/layout, including English/Chinese PO. Full-page capture produced repeated tiles, while the DOM count and viewport capture confirmed one document. Workbooks also checked through artifact-tool and independent LibreOffice print conversion.

Admin `claude-qa@crystocraft.com`: fresh password sign-in, dashboard/Settings, catalogue294products/713SKUs, refresh and runtime PASS. Actual saved PU260073 (`mcsL3ayn8WbhpLu7FSWR`) PDF view and Download Excel retain500pcs, numeric price2 and amount1000. Actual packing list `7L0z8J3SiyjZ5KuunLDu` (QU260709, UC4946/26) recovers unit Set from linked order:172×6=1032Set and168×1=168Set, total1200Set;7cartons, shipping83.8kg and0.5427CBM preserved in PDF view and downloaded workbook. No live saves or new documents. Read-only Firebase list identified the saved packing list after the first inspected shipment had no scenario; no data/rules changes.

Customer `customer-qa@crystocraft.com`: fresh password sign-in to approved QA-only home,24catalogue cards, Sacred Angel detail/prices, refresh, and runtime PASS. Both PO and packing admin print routes redirect to shop; no supplier/admin data visible. Both QA sessions signed out; owner session preserved. Screenshots under `/private/tmp/v818-evidence/`: packing-po-candidate-admin.png, packing-po-candidate-customer.png, packing-po-candidate-po.png, packing-po-candidate-packing.png. Roles/rules unchanged.

## Production PASS — 15 October 2026

Deploy `6ad0c893aee7f25fad4bbf4b`, release commit `dc2b9806ab83126b3a6cd99313443800985c34d7`, published23:36:24AEDT. Both production hostnames serve `/assets/index-DXjDx6JL.js`, V8.18 ·15Oct23:35; both configuration probes200.

- Admin `claude-qa@crystocraft.com`: fresh real password sign-in, dashboard/Settings, catalogue294products/713SKUs, refresh and runtime PASS. Actual production PU260073 print view/download show500pcs, numeric price2, amount1000. Saved packing list `7L0z8J3SiyjZ5KuunLDu` print view and actual XLSX download show172Set/carton×6=1032Set plus168Set/carton×1=168Set, total1200Set;7cartons, shipping83.8kg and0.5427CBM. Production workbooks reopened and assertions passed. No PO, order or packing record saved/edited during verification.
- Customer `customer-qa@crystocraft.com`: fresh real password sign-in to approved QA-only home,24catalogue cards, Sacred Angel detail/prices, refresh in correct shell, no private/admin controls and no runtime errors PASS. Both PO and packing print routes redirect to shop. Supplier details and costs remain inaccessible.
- GitHub Actions https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38735816799 PASS:39search/filter,5quote PDF,3quote Excel,13invoice and10packing/PO checks =70passed,0failed. Production build/lint passed;11configuration checks passed separately. No rules, profiles, roles or access changes/deployments.

Evidence in `/private/tmp/v818-evidence/`: packing-po-production-admin.png, packing-po-production-customer.png, packing-po-production-po.png, packing-po-production-packing.png; actual downloaded production XLSX copies prefixed production-. Both QA sessions signed out and owner session preserved. Temporary fixture server stopped. Closure documentation skips Netlify to retain this verified production build.
