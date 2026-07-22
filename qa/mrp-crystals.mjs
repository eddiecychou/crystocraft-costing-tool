// Headless check of the crystal half of computeRequirements.
//
// Uses D0092 Fan-Out Peacock's real derived BOM: 13 octagon 2h/14 and 9
// chaton/18, with MX splitting them 8+1+1+1+1+1 and 4+1+1+1+1+1.
//
//   node qa/mrp-crystals.mjs
//
// Run through esbuild first (it is JSX-free but imports .js siblings that are
// not, so bundling keeps it honest):
//   $ESB qa/mrp-crystals.mjs --bundle --platform=node --format=esm --outfile=/tmp/t.mjs
import { computeRequirements, colourFromItemCode } from '../src/mrp.js'

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`)
}

// Names are copied verbatim from the ERP item master, including the wording
// that carries hole count. An earlier version of this fixture abbreviated them
// and every plain colourway failed to resolve — the names are load-bearing.
const CRYSTALS = [
  { code: 'BDC-8232-0014-002', name: 'Bohemia glass 8232/14(C1) double hole Crystal', colour: 'C1', stock_qty: 41293 },
  { code: 'BDC-8232-0014-003', name: 'Bohemia glass 8232/14(GO) double hole Amber', colour: 'GO', stock_qty: 300 },
  { code: 'BDC-8232-0014-005', name: 'Bohemia glass 8232/14(PI) double hole Rosaline', colour: 'PI', stock_qty: 24977 },
  { code: 'C01-1028-18-002', name: 'Swarovski PP#1028/18 Crystal', colour: 'C1', stock_qty: 88410 },
  { code: 'C01-1028-18-005', name: 'Swarovski PP#1028/18 Rose', colour: 'PI', stock_qty: 12004, reserved_qty: 11000 },
  // Double space in "one  hole" is how the ERP actually writes it.
  { code: 'BDC-8149-0014-001', name: 'Bohemia glass 8149/14(BL) one  hole Medium Sapph', colour: 'BL', stock_qty: 500 },
]

const PRODUCT = {
  id: 'p1', design_code: '0092', format_code: '001', description: 'Fan-Out Peacock',
  critical_components: [],
  crystal_components: {
    positions: [
      { shape: 'chaton', size: '18', qty: 9 },
      { shape: 'octagon 2h', size: '14', qty: 13 },
    ],
    mixes: {
      MX: [
        { code: 'BDC-8232-0014-002', qty: 8 },
        { code: 'BDC-8232-0014-003', qty: 5 },
        { code: 'C01-1028-18-002', qty: 9 },
      ],
      // Offered, never ordered — must warn, not silently contribute zero.
      AX: [],
    },
  },
}

console.log('— colour parsing')
check('GMX -> MX', colourFromItemCode('D0092-001-GMX'), 'MX')
check('GAB -> AB', colourFromItemCode('U0257-001-GAB'), 'AB')
check('G   -> ""', colourFromItemCode('D0001-001-G'), '')

console.log('\n— a mix colourway uses the recipe')
{
  const { crystalRows, warnings } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GMX', qty_ordered: 100, order_label: 'PI-1' }],
    products: [PRODUCT], lib: [], crystals: CRYSTALS,
  })
  const by = Object.fromEntries(crystalRows.map(r => [r.code, r]))
  check('Bohemia Crystal 8/unit x100', by['BDC-8232-0014-002'].required, 800)
  check('Bohemia Amber 5/unit x100', by['BDC-8232-0014-003'].required, 500)
  check('Swarovski Crystal 9/unit x100', by['C01-1028-18-002'].required, 900)
  check('Amber short by 200', by['BDC-8232-0014-003'].shortage, 200)
  check('Crystal not short', by['BDC-8232-0014-002'].shortage, 0)
  check('no crystal warnings', warnings.filter(w => /crystal|mix|stone/.test(w.reason)).length, 0)
}

console.log('\n— a plain colour resolves by shape+size+colour, no recipe needed')
{
  const { crystalRows } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GPI', qty_ordered: 10 }],
    products: [PRODUCT], lib: [], crystals: CRYSTALS,
  })
  const by = Object.fromEntries(crystalRows.map(r => [r.code, r]))
  check('13 octagons in Rosaline', by['BDC-8232-0014-005'].required, 130)
  check('9 chatons in Rose', by['C01-1028-18-005'].required, 90)
  // 12,004 on hand but 11,000 reserved -> 1,004 available, so no shortage yet.
  check('reserved stock reduces availability', by['C01-1028-18-005'].inStock, 1004)
}

console.log('\n— an undefined mix warns instead of contributing nothing')
{
  const { crystalRows, warnings } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GAX', qty_ordered: 50 }],
    products: [PRODUCT], lib: [], crystals: CRYSTALS,
  })
  check('no stones counted', crystalRows.length, 0)
  check('warns about the empty recipe',
    warnings.some(w => /mix AX has no recipe/.test(w.reason)), true)
}

console.log('\n— a colour with no matching stone warns')
{
  const { warnings } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GEM', qty_ordered: 5 }],
    products: [PRODUCT], lib: [], crystals: CRYSTALS,
  })
  check('warns per unresolved position',
    warnings.filter(w => /no .* stone in colour EM/.test(w.reason)).length, 2)
}

console.log('\n— a product with no crystal BOM warns instead of staying silent')
{
  const bare = { ...PRODUCT, id: 'p2', crystal_components: undefined }
  const { crystalRows, warnings } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GMX', qty_ordered: 20 }],
    products: [bare], lib: [], crystals: CRYSTALS,
  })
  check('no stones counted', crystalRows.length, 0)
  check('warns that the BOM is missing',
    warnings.some(w => /no crystal BOM on/.test(w.reason)), true)
}

console.log('\n— an empty BOM object counts as missing, not as "needs none"')
{
  const empty = { ...PRODUCT, id: 'p3', crystal_components: { positions: [], mixes: {}, source: 'manual' } }
  const { warnings } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GMX', qty_ordered: 20 }],
    products: [empty], lib: [], crystals: CRYSTALS,
  })
  check('still warns', warnings.some(w => /no crystal BOM on/.test(w.reason)), true)
}

console.log('\n— a product WITH a BOM does not get the missing-BOM warning')
{
  const { warnings } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GMX', qty_ordered: 20 }],
    products: [PRODUCT], lib: [], crystals: CRYSTALS,
  })
  check('no false positive', warnings.some(w => /no crystal BOM on/.test(w.reason)), false)
}

console.log('\n— crystals are counted even with no critical components')
{
  const { crystalRows } = computeRequirements({
    lines: [{ item_code: 'D0092-001-GMX', qty_ordered: 1 }],
    products: [PRODUCT], lib: [], crystals: CRYSTALS,
  })
  check('still produced rows', crystalRows.length > 0, true)
}

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
