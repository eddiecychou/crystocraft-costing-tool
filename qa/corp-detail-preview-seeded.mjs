// Headless preview of CorporateDetail (/shop/corporate/:id) — login-gated.
// esbuild-bundles the real component with the Firestore data layer stubbed +
// seeded. See UI-POLISH.md §4a.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const mkImg = (n) => {
  const svg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">' +
    '<rect width="800" height="800" fill="#efe6d8"/>' +
    '<rect x="' + (250 + n*20) + '" y="120" width="220" height="560" rx="18" fill="#3b3f4a"/>' +
    '<text x="400" y="70" font-size="24" fill="#8a3b52" text-anchor="middle" font-family="sans-serif">TOP EDGE ' + n + '</text>' +
    '<text x="400" y="760" font-size="24" fill="#8a3b52" text-anchor="middle" font-family="sans-serif">BOTTOM EDGE</text>' +
    '</svg>');
  return 'data:image/svg+xml;utf8,' + svg;
};
const IMG = mkImg(0);

const PRODUCT = {
  id: 'p1',
  name: 'Etched Crystal Recognition Award',
  category: 'Awards',
  marketing_description: 'A sculptural optical-crystal award with a bevelled edge and a deep-etched 3D logo — presented in a satin-lined gift box. Made for milestone recognition, partner appreciation and annual conferences.',
  description: 'Overall height 220 mm. Sub-surface laser engraving. Felt-based non-slip pad.',
  heroImage: IMG,
  active: true,
  status: 'active',
  videos: [],
}
const IMAGES = [
  { id: 'i0', file_url: mkImg(0), sort_order: 0, caption: '' },
  { id: 'i1', file_url: mkImg(1), sort_order: 1, caption: 'Detail — etched logo face' },
  { id: 'i2', file_url: mkImg(2), sort_order: 2, caption: 'In the satin gift box' },
  { id: 'i3', file_url: mkImg(3), sort_order: 3, caption: '' },
]
const TIERS = [
  { quantity: 50, price_hkd: 640 }, { quantity: 100, price_hkd: 520 },
  { quantity: 250, price_hkd: 430 }, { quantity: 500, price_hkd: 380 },
]

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
    const IMAGES = ${JSON.stringify(IMAGES)};
    const TIERS = ${JSON.stringify(TIERS)};
    export const onSnapshot = (ref, next) => {
      try {
        const s = JSON.stringify(ref);
        if (s.includes('images')) next({ docs: IMAGES.map(d => ({ id: d.id, data: () => d })), forEach: () => {} });
        else next({ exists: () => true, id: 'p1', data: () => PRODUCT });
      } catch (e) {}
      return () => {};
    };
    export const getDoc = async (ref) => {
      const s = JSON.stringify(ref);
      if (s.includes('customer_prices')) return { exists: () => true, data: () => ({ tiers: TIERS }) };
      return { exists: () => true, data: () => PRODUCT };
    };
    export const getDocs = async () => ({ docs: [], forEach: () => {} });
    export const setDoc = async () => {}; export const addDoc = async () => ({ id: 'x' });
    export const deleteDoc = async () => {}; export const updateDoc = async () => {};
    export const serverTimestamp = () => null;
  `,
  currency: `
    export const useRates = () => ({});
    export const convertFromHKD = (hkd) => hkd / 7.8;
    export const convertFromUSD = (usd) => usd;
    export const fmtMoney = (n, cur) => (n == null ? '—' : (cur || 'USD') + ' ' + Number(n).toFixed(2));
  `,
  customizerEngines: `
    export const engineTypeOf = () => null;
    export const engineAvailable = () => false;
    export const engineLabel = () => '';
  `,
}
const map = {
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
  'currency': /(^|\/)currency$/, 'customizerEngines': /(^|\/)customizerEngines$/,
}
const stubPlugin = { name: 'qa-stubs', setup(b) {
  for (const [k, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: k, namespace: 'qa-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
}}

await build({
  entryPoints: ['qa/corp-detail-preview.jsx'],
  bundle: true, outfile: 'qa/corp-detail-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/corp-detail-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — CorporateDetail</title><link rel="stylesheet" href="./corp-detail-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./corp-detail-preview-seeded.js"></script></body></html>`)
console.log('built qa/corp-detail-preview-seeded.{js,css,html}')
