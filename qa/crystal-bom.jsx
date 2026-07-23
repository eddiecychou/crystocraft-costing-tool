// Render CrystalBomEditor on its own, with real data shapes.
//
// /range/:id sits behind an admin login, so the editor cannot be reached in a
// fresh browser without signing in as the owner. This mounts the component
// directly at /qa/crystal-bom.html so its layout and states can actually be
// looked at — the V7.17 lesson being that esbuild proves nothing about layout.
//
// Data below is D0092 Fan-Out Peacock as derived from the ERP, plus one
// deliberately broken mix and one crystal code the stock list does not carry,
// so the warning states are visible rather than theoretical.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import CrystalBomEditor from '../src/components/CrystalBomEditor'

const CRYSTALS = [
  { code: 'BDC-8232-0014-002', name: 'Bohemia glass 8232/14(C1) double hole Crystal', colour: 'C1', stock_qty: 41293 },
  { code: 'BDC-8232-0014-003', name: 'Bohemia glass 8232/14(GO) double hole Amber', colour: 'GO', stock_qty: 8121 },
  { code: 'BDC-8232-0014-004', name: 'Bohemia glass 8232/14(GR) double hole Aquamarine', colour: 'GR', stock_qty: 6640 },
  { code: 'BDC-8232-0014-005', name: 'Bohemia glass 8232/14(PI) double hole Rosaline', colour: 'PI', stock_qty: 24977 },
  { code: 'BDC-8232-0014-006', name: 'Bohemia glass 8232/14(PU) double hole BlueViolet', colour: 'PU', stock_qty: 5512 },
  { code: 'BDC-8232-0014-007', name: 'Bohemia glass 8232/14(RE) double hole Ruby', colour: 'RE', stock_qty: 10512 },
  { code: 'C01-1028-18-002', name: 'Swarovski PP#1028/18 Crystal', colour: 'C1', stock_qty: 88410 },
  { code: 'C01-1028-18-005', name: 'Swarovski PP#1028/18 Rose', colour: 'PI', stock_qty: 12004 },
  { code: 'C01-1028-18-008', name: 'Swarovski PP#1028/18 Emerald', colour: 'EM', stock_qty: 9330 },
  { code: 'C01-1028-18-009', name: 'Swarovski PP#1028/18 Topaz', colour: 'TO', stock_qty: 7781 },
  { code: 'C01-1028-18-015', name: 'Swarovski PP#1028/18 Amethyst', colour: '', stock_qty: 4210 },
  { code: 'C01-1028-18-022', name: 'Swarovski PP#1028/18 Siam', colour: '', stock_qty: 3390 },
]

const MIX_CODES = ['MX', 'M1', 'M2', 'M3', 'M4', 'AX', 'GX']

const INITIAL = {
  // 'erp-rescue' is the provenance for a BOM inferred from a predecessor route
  // or a sibling format — it must badge differently from a direct derivation.
  source: 'erp-rescue',
  rescued_from: ['U0092-001-GMX', 'U0092-001-GC1'],
  derived_at: '2026-07-22T13:36:55.382Z',
  positions: [
    { shape: 'chaton', size: '18', qty: 9 },
    { shape: 'octagon 2h', size: '14', qty: 13 },
    // An unclassified pattern, to check the editor keeps the label verbatim
    // instead of snapping it to the nearest dropdown entry.
    { shape: '#8015 1h', size: '20', qty: 0 },
  ],
  mixes: {
    MX: [
      { code: 'BDC-8232-0014-002', qty: 8 },
      { code: 'BDC-8232-0014-003', qty: 1 },
      { code: 'BDC-8232-0014-004', qty: 1 },
      { code: 'BDC-8232-0014-005', qty: 1 },
      { code: 'BDC-8232-0014-006', qty: 1 },
      { code: 'BDC-8232-0014-007', qty: 1 },
      { code: 'C01-1028-18-002', qty: 4 },
      { code: 'C01-1028-18-005', qty: 1 },
      { code: 'C01-1028-18-008', qty: 1 },
      { code: 'C01-1028-18-009', qty: 1 },
      { code: 'C01-1028-18-015', qty: 1 },
      { code: 'C01-1028-18-022', qty: 1 },
    ],
    // Deliberately short, and pointing at a stone the app does not stock — the
    // two states the editor has to make obvious.
    M1: [
      { code: 'BDC-8232-0014-002', qty: 8 },
      { code: 'C01-1028-26-017', qty: 2 },
    ],
    // Offered but never ordered: the 286-mix case, which must not read as zero.
    AX: [],
  },
}

function Harness() {
  const [bom, setBom] = useState(INITIAL)
  return (
    <div className="min-h-screen bg-ivory p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg text-ink-90">QA — Crystal BOM editor</h1>
          <p className="text-xs text-ink-60">D0092-001 Fan-Out Peacock, derived from the ERP.</p>
        </div>
        <CrystalBomEditor bom={bom} onChange={setBom} crystals={CRYSTALS} mixCodes={MIX_CODES} />
        <details className="card p-4">
          <summary className="text-xs text-ink-60 cursor-pointer">Stored value</summary>
          <pre className="text-[10px] mt-2 overflow-auto">{JSON.stringify(bom, null, 2)}</pre>
        </details>
      </div>
    </div>
  )
}

// Reuse the root across hot updates. Calling createRoot again on every HMR
// pass filled the console with React warnings and made it impossible to tell a
// real component error from noise while checking this page.
const el = document.getElementById('root')
const root = (window.__qaRoot ||= createRoot(el))
root.render(<Harness />)
