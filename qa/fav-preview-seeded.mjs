// Headless preview of FavouritesPage (/shop/favourites) — login-gated.
// esbuild-bundles the real component with store stubbed + seeded. See UI-POLISH.md §4a.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const mkImg = (label, fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
  '<rect width="300" height="300" fill="' + fill + '"/>' +
  '<text x="150" y="160" font-size="26" fill="#fff" text-anchor="middle" font-family="sans-serif">' + label + '</text></svg>')

const FAVS = [
  { type: 'figurine', id: 'd1', name: 'Prancing Horse — Optical Crystal Figurine', code: 'D0002-FS', image: mkImg('HORSE', '#6e2433') },
  { type: 'corporate', id: 'p9', name: 'Etched Crystal Recognition Award', code: 'CG-AWARD-07', image: mkImg('AWARD', '#996632') },
  { type: 'corporate', id: 'p12', name: 'Desk Globe Paperweight (in your enquiry already)', code: 'CG-GLOBE-02', image: mkImg('GLOBE', '#1C4F64') },
  { type: 'figurine', id: 'd7', name: 'Guardian Angel — no photo on file', code: 'D0114-FR', image: '' },
]

const STUBS = {
  firebase: `
    export const db = {}; export const auth = { currentUser: { uid: 'u1', email: 'x@y.z' } }; export const storage = {};
    export const authHeader = async () => ({}); export default {};
  `,
  firestore: `
    export const collection = (...a) => ({ a }); export const doc = (...a) => ({ a });
    export const query = (...a) => ({ a }); export const where = (...a) => ({ a });
    export const orderBy = (...a) => ({ a }); export const limit = (...a) => ({ a });
    export const onSnapshot = () => () => {};
    export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
    export const getDocs = async () => ({ docs: [], forEach: () => {} });
    export const addDoc = async () => ({ id: 'x' }); export const setDoc = async () => {};
    export const updateDoc = async () => {}; export const deleteDoc = async () => {};
    export const serverTimestamp = () => null;
  `,
  store: `
    const FAVS = ${JSON.stringify(FAVS)};
    export const CartProvider = ({ children }) => children;
    export const FavouritesProvider = ({ children }) => children;
    export const useFavourites = () => ({ items: FAVS, toggle: () => {}, has: () => true });
    export const useCart = () => ({
      items: [], add: () => {}, remove: () => {}, clear: () => {},
      has: (x) => x && x.id === 'p12',
    });
    export const designGroupKey = (i) => 'design:' + (i.design_no || i.id || '');
    export const formatGroupKey = (i) => 'fmt:' + (i.format_code || '');
    export const formatCodeOf = (i) => i.format_code || '';
    export const designNumberOf = (i) => i.design_no || '';
  `,
}
const map = {
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/, 'store': /(^|\/)store$/,
}
const stubPlugin = { name: 'qa-stubs', setup(b) {
  for (const [k, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: k, namespace: 'qa-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
}}

await build({
  entryPoints: ['qa/fav-preview.jsx'],
  bundle: true, outfile: 'qa/fav-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/fav-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — FavouritesPage</title><link rel="stylesheet" href="./fav-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./fav-preview-seeded.js"></script></body></html>`)
console.log('built qa/fav-preview-seeded.{js,css,html}')
