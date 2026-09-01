// Headless preview of FigurineDetail (/shop/figurine/:id) — login-gated.
// esbuild-bundles the real component with the Firestore data layer + domain
// hooks stubbed and seeded. See UI-POLISH.md §4a.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const mkImg = (n) => {
  const svg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">' +
    '<rect width="800" height="800" fill="#f4ede1"/>' +
    '<circle cx="400" cy="430" r="150" fill="#c9b070"/>' +
    '<rect x="330" y="120" width="140" height="240" fill="#3b3f4a"/>' +
    '<text x="400" y="70" font-size="26" fill="#8a3b52" text-anchor="middle" font-family="sans-serif">TOP EDGE ' + n + '</text>' +
    '<text x="400" y="770" font-size="26" fill="#8a3b52" text-anchor="middle" font-family="sans-serif">BOTTOM EDGE</text>' +
    '</svg>')
  return 'data:image/svg+xml;utf8,' + svg
}

const PRODUCT = {
  id: 'd1',
  design_code: 'D0002',
  design_no: '0002',
  format_code: 'FS',
  design_name: 'Prancing Horse',
  description: 'Prancing Horse — Optical Crystal Figurine',
  design_type: 'Animal',
  status: 'active',
  moq: 300,
  size: 'H 120 × W 90 × D 45 mm',
  marketing_description: 'A hand-polished optical-crystal horse caught mid-stride, its mane picked out in faceted cut crystal. A collector-grade desk piece and a milestone gift.',
  gallery: [
    { url: mkImg(1), caption: 'Three-quarter view' },
    { url: mkImg(2), caption: 'Detail — faceted mane' },
    { url: mkImg(3), caption: '' },
  ],
  crystal_mixes: {},
  packing: { pcs_per_carton: 24 },
  videos: [],
  variants: [
    { plating_name: 'Rhodium', plating_code: 'RH', brand_code: 'D', sku: 'D0002-001', ws_price_usd: 18.5, crystal_colors: [] },
    { plating_name: 'Gold', plating_code: 'GT', brand_code: 'D', sku: 'D0002-002', ws_price_usd: 21.0, crystal_colors: [] },
    { plating_name: 'Gunmetal', plating_code: 'GM', brand_code: 'D', sku: 'D0002-003', ws_price_usd: 19.5, crystal_colors: [] },
  ],
}

const STUBS = {
  firebase: `
    export const db = {}; export const auth = { currentUser: { uid: 'u1' } }; export const storage = {};
    export const authHeader = async () => ({}); export default {};
  `,
  firestore: `
    export const doc = (...a) => ({ a }); export const collection = (...a) => ({ a });
    export const query = (...a) => ({ a }); export const where = (...a) => ({ a });
    export const orderBy = (...a) => ({ a }); export const limit = (...a) => ({ a });
    const PRODUCT = ${JSON.stringify(PRODUCT)};
    export const onSnapshot = (ref, next) => {
      try { next({ exists: () => true, id: 'd1', data: () => PRODUCT }) } catch (e) {}
      return () => {};
    };
    export const getDoc = async () => ({ exists: () => true, id: 'd1', data: () => PRODUCT });
    export const getDocs = async () => ({ docs: [], forEach: () => {} });
    export const setDoc = async () => {}; export const addDoc = async () => ({ id: 'x' });
    export const deleteDoc = async () => {}; export const updateDoc = async () => {};
    export const serverTimestamp = () => null;
  `,
  currency: `
    export const useRates = () => ({});
    export const convertFromUSD = (usd) => usd;
    export const convertFromHKD = (hkd) => hkd / 7.8;
    export const fmtMoney = (n, cur) => (n == null ? '\\u2014' : (cur || 'USD') + ' ' + Number(n).toFixed(2));
    export const wsPriceFactor = () => 1;
  `,
  crystalColors: `
    export const useCrystalColors = () => ({ colors: [] });
    export const colorMap = () => ({});
  `,
  formatMoq: `
    export const useFormatMoq = () => ({ moq: {}, labels: {} });
  `,
  criticalComponents: `
    export const useComponents = () => ({ components: [] });
    export const productAvailability = () => ({
      customerPromise: 'Made to order \\u2014 approx. 4\\u20136 weeks from approval',
      byPlating: {}, buildable: 0,
    });
  `,
  useProductDefaults: `
    export const useProductDefaults = () => ({});
  `,
}
const map = {
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
  'currency': /(^|\/)currency$/, 'crystalColors': /(^|\/)crystalColors$/,
  'formatMoq': /(^|\/)formatMoq$/, 'criticalComponents': /(^|\/)criticalComponents$/,
  'useProductDefaults': /(^|\/)useProductDefaults$/,
}
const stubPlugin = { name: 'qa-stubs', setup(b) {
  for (const [k, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: k, namespace: 'qa-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
}}

await build({
  entryPoints: ['qa/fig-detail-preview.jsx'],
  bundle: true, outfile: 'qa/fig-detail-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/fig-detail-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — FigurineDetail</title><link rel="stylesheet" href="./fig-detail-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./fig-detail-preview-seeded.js"></script></body></html>`)
console.log('built qa/fig-detail-preview-seeded.{js,css,html}')
