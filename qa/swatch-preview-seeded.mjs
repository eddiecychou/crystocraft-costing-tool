// Headless preview of SwatchLibraryPage (/shop/swatches) — login-gated.
// esbuild-bundles the real component with swatchLibraryApi / store stubbed
// + seeded. See UI-POLISH.md §4a.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const mkImg = (label, fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
  '<rect width="300" height="300" fill="' + fill + '"/>' +
  '<text x="150" y="160" font-size="22" fill="#fff" text-anchor="middle" font-family="sans-serif">' + label + '</text></svg>')

const NAMES = ['Aurora Borealis', 'Crystal AB', 'Jet Black', 'Light Rose', 'Sapphire', 'Vitrail Light']
const COLORS = ['#8b3347', '#1C4F64', '#222222', '#cc94a0', '#1c4f64', '#996632']
const REGISTRY = {}
NAMES.forEach((name, i) => {
  REGISTRY[name] = {
    rgb: [0.5, 0.3, 0.4],
    slots: i === 0
      ? { fabric: { clear: { file: 'f1.jpg' }, ab: { file: 'f2.jpg' } }, rock: { clear: { file: 'r1.jpg' } } }
      : { fabric: { clear: { file: `s${i}.jpg` } } },
  }
})
const IMG_BY_FILE = { f1: mkImg('FABRIC 1', '#6e2433'), f2: mkImg('FABRIC 2', '#7A4F26'), r1: mkImg('ROCK 1', '#1C4F64') }
NAMES.forEach((n, i) => { IMG_BY_FILE[`s${i}`] = mkImg(n.split(' ')[0].toUpperCase(), COLORS[i]) })

const STUBS = {
  swatchLibraryApi: `
    const REGISTRY = ${JSON.stringify(REGISTRY)};
    const IMG_BY_FILE = ${JSON.stringify(IMG_BY_FILE)};
    export const fetchSwatchRegistry = async () => REGISTRY;
    export const fetchSwatchImageUrl = async (filename) => IMG_BY_FILE[filename.replace(/\\.[a-z]+$/,'')] || IMG_BY_FILE.f1;
    export const loadSwatchNotes = async (name) => name === 'Aurora Borealis'
      ? { legacy_swarovski_refs: ['001AB', '001'] } : {};
  `,
  store: `
    export const CartProvider = ({ children }) => children;
    export const FavouritesProvider = ({ children }) => children;
    export const useCart = () => ({ items: [], add: () => {}, remove: () => {}, clear: () => {}, has: () => false });
    export const useFavourites = () => ({ has: () => false, toggle: () => {}, ids: [] });
    export const designGroupKey = (i) => 'design:' + (i.design_no || i.id || '');
    export const formatGroupKey = (i) => 'fmt:' + (i.format_code || '');
    export const formatCodeOf = (i) => i.format_code || '';
    export const designNumberOf = (i) => i.design_no || '';
  `,
  firebase: `
    export const db = {}; export const auth = { currentUser: { uid: 'u1' } }; export const storage = {};
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
}
const map = {
  'swatchLibraryApi': /(^|\/)swatchLibraryApi$/, 'store': /(^|\/)store$/,
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
}
const stubPlugin = { name: 'qa-stubs', setup(b) {
  for (const [k, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: k, namespace: 'qa-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
}}

await build({
  entryPoints: ['qa/swatch-preview.jsx'],
  bundle: true, outfile: 'qa/swatch-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/swatch-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — SwatchLibraryPage</title><link rel="stylesheet" href="./swatch-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./swatch-preview-seeded.js"></script></body></html>`)
console.log('built qa/swatch-preview-seeded.{js,css,html}')
