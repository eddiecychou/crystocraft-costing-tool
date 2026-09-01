// Headless preview of the customer FigurineShop (/shop/figurine) — login-gated,
// so this esbuild-bundles the real component with the Firestore data layer
// stubbed + seeded (10 fake designs, one flagged is_new, one 'stock'/'concept').
// Pattern mirrors qa/home-preview-seeded.mjs — see UI-POLISH.md §4a.
//
//   node qa/figurine-preview-seeded.mjs   # -> qa/figurine-preview-seeded.{js,css,html}
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const DESIGNS = Array.from({ length: 10 }, (_, i) => ({
  id: 'd' + i,
  design_code: (i === 7 ? 'U' : i === 8 ? 'A' : 'D') + String(3300 + i),
  design_no: String(3300 + i),
  format_code: '001',
  description: ['Zodiac Rabbit', 'Fan-Out Peacock', 'Crystal Rose Bloom', 'Guardian Lion Pair',
    'Lucky Koi', 'Blossom Carousel', 'Star Voyager Ship', 'Serenity Buddha',
    'Dancing Crane', 'Prosperity Tree'][i],
  design_type: i % 3 === 0 ? 'Animals' : i % 3 === 1 ? 'Symbolic' : 'Nature',
  size: ['6 x 8 cm', '9 x 12 cm', '4 x 5 cm'][i % 3],
  active: true,
  status: i === 2 ? 'stock' : i === 5 ? 'concept' : 'active',
  is_new: i === 1 || i === 7 || i === 8,   // d7=U (Swarovski), d8=A (Asfour) — both NEW
  gallery: [],
  finishes: [
    { finish_name: 'Chrome', sku: 'D' + (3300 + i) + '-CH', ws_price_usd: 4 + i * 0.4, image: '' },
    { finish_name: 'Gold', sku: 'D' + (3300 + i) + '-GD', ws_price_usd: 5 + i * 0.4, image: '' },
  ],
}))

const STUBS = {
  firebase: `
    export const db = {}; export const auth = { currentUser: null }; export const storage = {};
    export const authHeader = async () => ({}); export default {};
  `,
  firestore: `
    export const doc = (...a) => ({ a }); export const collection = (...a) => ({ a });
    export const query = (...a) => ({ a }); export const where = (...a) => ({ a });
    export const orderBy = (...a) => ({ a }); export const limit = (...a) => ({ a });
    const DESIGNS = ${JSON.stringify(DESIGNS)};
    export const onSnapshot = (ref, next) => {
      try {
        const isRange = JSON.stringify(ref).includes('range_products');
        next({ docs: isRange ? DESIGNS.map(d => ({ id: d.id, data: () => d })) : [], forEach: () => {} });
      } catch (e) {}
      return () => {};
    };
    export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
    export const getDocs = async () => ({ docs: [], forEach: () => {} });
    export const setDoc = async () => {}; export const addDoc = async () => ({ id: 'x' });
    export const deleteDoc = async () => {}; export const updateDoc = async () => {};
    export const serverTimestamp = () => null;
  `,
  catalogueCollections: `export const collectionProducts = (c, items) => items;`,
  // CollectionBand pulls in a chain of settings hooks — render nothing in the harness
  CollectionBand: `export default function CollectionBand(){ return null; }`,
  // currency / formatMoq: neutral
  currency: `
    export const useRates = () => ({});
    export const convertFromUSD = (usd) => usd;
    export const fmtMoney = (n, cur) => (n == null ? '—' : (cur || 'USD') + ' ' + Number(n).toFixed(2));
    export const wsPriceFactor = () => 1;
  `,
  formatMoq: `export const useFormatMoq = () => ({ labels: {} });`,
}

const stubPlugin = {
  name: 'qa-stubs',
  setup(b) {
    const map = {
      'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
      'catalogueCollections': /(^|\/)catalogueCollections$/, 'CollectionBand': /(^|\/)CollectionBand$/, 'currency': /(^|\/)currency$/,
      'formatMoq': /(^|\/)formatMoq$/,
    }
    for (const [key, re] of Object.entries(map)) {
      b.onResolve({ filter: re }, () => ({ path: key, namespace: 'qa-stub' }))
    }
    b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
  },
}

await build({
  entryPoints: ['qa/figurine-preview.jsx'],
  bundle: true,
  outfile: 'qa/figurine-preview-seeded.js',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})

writeFileSync('qa/figurine-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — FigurineShop</title><link rel="stylesheet" href="./figurine-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./figurine-preview-seeded.js"></script></body></html>`)
console.log('built qa/figurine-preview-seeded.{js,css,html}')
