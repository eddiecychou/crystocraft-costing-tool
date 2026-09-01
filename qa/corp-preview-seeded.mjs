// Headless preview of the customer CorporateShop (/shop/corporate) — login-gated.
// esbuild-bundles the real component with the Firestore data layer stubbed +
// seeded (10 fake corp-gift products, 2 flagged is_new). See UI-POLISH.md §4a.
//
//   node qa/corp-preview-seeded.mjs   # -> qa/corp-preview-seeded.{js,css,html}
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const NAMES = ['Etched Crystal Award', 'Desk Globe Paperweight', 'Executive Pen Set',
  'Illuminated Trophy Base', 'Faceted Bookend Pair', 'Crystal Business Card Holder',
  'Prism Desk Clock', 'Engraved Champagne Flutes', 'Star Ornament Keepsake', 'Diamond Coaster Set']
const PRODUCTS = Array.from({ length: 10 }, (_, i) => ({
  id: 'p' + i,
  name: NAMES[i],
  category: ['Awards', 'Desk', 'Drinkware'][i % 3],
  description: 'A refined ' + NAMES[i].toLowerCase() + ' with laser-engraved branding, presented in a gift box.',
  active: true,
  status: 'active',
  is_new: i === 0 || i === 4,
  heroImage: '',
  createdAt: { seconds: 1780000000 - i * 1000 },
}))

const STUBS = {
  firebase: `
    export const db = {}; export const auth = { currentUser: { uid: 'u1' } }; export const storage = {};
    export const authHeader = async () => ({}); export default {};
  `,
  firestore: `
    export const doc = (...a) => ({ a }); export const collection = (...a) => ({ a });
    export const query = (...a) => ({ a }); export const where = (...a) => ({ a });
    export const orderBy = (...a) => ({ a }); export const limit = (...a) => ({ a });
    const PRODUCTS = ${JSON.stringify(PRODUCTS)};
    export const onSnapshot = (ref, next) => {
      try {
        const isProducts = JSON.stringify(ref).includes('"products"') && !JSON.stringify(ref).includes('images') && !JSON.stringify(ref).includes('customer_prices');
        next({ docs: isProducts ? PRODUCTS.map(p => ({ id: p.id, data: () => p })) : [], forEach: () => {} });
      } catch (e) {}
      return () => {};
    };
    export const getDocs = async () => ({ docs: [], forEach: () => {} });   // product images subcollection -> empty (Package fallback)
    export const getDoc = async (ref) => {
      const s = JSON.stringify(ref);
      const m = s.match(/"p(\\d)"/);
      const even = m && Number(m[1]) % 2 === 0;
      return { exists: () => !!even, data: () => ({ tiers: [{ price_hkd: 320 + (m ? Number(m[1]) : 0) * 40 }] }) };
    };
    export const setDoc = async () => {}; export const addDoc = async () => ({ id: 'x' });
    export const deleteDoc = async () => {}; export const updateDoc = async () => {};
    export const serverTimestamp = () => null;
  `,
  catalogueCollections: `export const collectionProducts = (c, items) => items;`,
  CollectionBand: `export default function CollectionBand(){ return null; }`,
  currency: `
    export const useRates = () => ({});
    export const convertFromHKD = (hkd) => hkd / 7.8;
    export const convertFromUSD = (usd) => usd;
    export const fmtMoney = (n, cur) => (n == null ? '—' : (cur || 'USD') + ' ' + Number(n).toFixed(2));
    export const wsPriceFactor = () => 1;
  `,
}

const map = {
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
  'catalogueCollections': /(^|\/)catalogueCollections$/, 'CollectionBand': /(^|\/)CollectionBand$/,
  'currency': /(^|\/)currency$/,
}
const stubPlugin = {
  name: 'qa-stubs',
  setup(b) {
    for (const [key, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: key, namespace: 'qa-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
  },
}

await build({
  entryPoints: ['qa/corp-preview.jsx'],
  bundle: true, outfile: 'qa/corp-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/corp-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — CorporateShop</title><link rel="stylesheet" href="./corp-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./corp-preview-seeded.js"></script></body></html>`)
console.log('built qa/corp-preview-seeded.{js,css,html}')
