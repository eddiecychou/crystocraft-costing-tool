// Headless preview of EnquiryPage (/shop/enquiry) — login-gated.
// esbuild-bundles the real component with the cart / data layer stubbed +
// seeded. See UI-POLISH.md §4a.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const mkImg = (label, fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
  '<rect width="200" height="200" fill="' + fill + '"/>' +
  '<text x="100" y="108" font-size="20" fill="#fff" text-anchor="middle" font-family="sans-serif">' + label + '</text></svg>')

const ITEMS = [
  { key: 'k1', type: 'figurine', id: 'd1', name: 'Prancing Horse — Optical Crystal Figurine',
    code: 'D0002-001-FS', design_no: '0002', format_code: 'MB', image: mkImg('HORSE', '#6e2433'),
    qty: 96, finish: 'Rhodium', color_name: 'Aurora', ws_price_usd: 18.5, pcs_per_carton: 24, cartons: 4, moq: 300, status: '' },
  { key: 'k2', type: 'figurine', id: 'd2', name: 'Guardian Angel', code: 'D0114-002-FR',
    design_no: '0114', format_code: 'FR', image: mkImg('ANGEL', '#1C4F64'),
    qty: 150, finish: 'Gold', ws_price_usd: 12.0, pcs_per_carton: 0, cartons: 0, moq: 0, status: '' },
  { key: 'k3', type: 'corporate', id: 'p9', name: 'Etched Crystal Recognition Award (concept)',
    code: 'CG-AWARD-07', image: mkImg('AWARD', '#996632'),
    qty: 50, ws_price_usd: null, pcs_per_carton: 0, cartons: 0, moq: 0, status: 'concept' },
]

const STUBS = {
  firebase: `
    export const db = {}; export const auth = { currentUser: { uid: 'u1', email: 'buyer@acme.example' } }; export const storage = {};
    export const authHeader = async () => ({}); export default {};
  `,
  firestore: `
    export const collection = (...a) => ({ a }); export const addDoc = async () => ({ id: 'x' });
    export const query = (...a) => ({ a }); export const where = (...a) => ({ a });
    export const orderBy = (...a) => ({ a }); export const limit = (...a) => ({ a });
    export const doc = (...a) => ({ a }); export const onSnapshot = () => () => {};
    export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
    export const getDocs = async () => ({ docs: [], forEach: () => {} });
    export const setDoc = async () => {}; export const updateDoc = async () => {};
    export const deleteDoc = async () => {}; export const serverTimestamp = () => null;
  `,
  store: `
    import { createElement } from 'react';
    const ITEMS = ${JSON.stringify(ITEMS)};
    export const CartProvider = ({ children }) => children;
    export const FavouritesProvider = ({ children }) => children;
    export const useCart = () => ({ items: ITEMS, update: () => {}, remove: () => {}, clear: () => {} });
    export const useFavourites = () => ({ has: () => false, toggle: () => {}, ids: [] });
    export const designGroupKey = (i) => 'design:' + (i.design_no || i.id || '');
    export const formatGroupKey = (i) => 'fmt:' + (i.format_code || '');
    export const formatCodeOf = (i) => i.format_code || '';
    export const designNumberOf = (i) => i.design_no || '';
  `,
  formatMoq: `
    export const useFormatMoq = () => ({ moq: { MB: 5000 }, labels: { MB: 'Music box' } });
  `,
  currency: `
    export const useRates = () => ({});
    export const convertFromUSD = (usd) => usd;
    export const fmtMoney = (n, cur) => (n == null ? '\\u2014' : (cur || 'USD') + ' ' + Number(n).toFixed(2));
    export const wsPriceFactor = () => 1;
  `,
  notify: `
    export const notifyEmail = () => {};
  `,
}
const map = {
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
  'store': /(^|\/)store$/, 'formatMoq': /(^|\/)formatMoq$/,
  'currency': /(^|\/)currency$/, 'notify': /(^|\/)notify$/,
}
const stubPlugin = { name: 'qa-stubs', setup(b) {
  for (const [k, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: k, namespace: 'qa-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
}}

await build({
  entryPoints: ['qa/enquiry-preview.jsx'],
  bundle: true, outfile: 'qa/enquiry-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/enquiry-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — EnquiryPage</title><link rel="stylesheet" href="./enquiry-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./enquiry-preview-seeded.js"></script></body></html>`)
console.log('built qa/enquiry-preview-seeded.{js,css,html}')
