// Headless preview of OrderHistoryPage (/shop/orders) — login-gated.
// esbuild-bundles the real component with the data layer stubbed + seeded.
// See UI-POLISH.md §4a.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const ROWS = []
for (let i = 0; i < 13; i++) {
  const app = i % 3 === 0
  ROWS.push({
    key: 'r' + i,
    no: (app ? 'SI-A' : 'SI-J') + String(2600 + i),
    uc: 'UC' + (4900 + i) + '/26',
    date: new Date(2026, 7 - (i % 6), 2 + i).toISOString(),
    currency: i % 2 ? 'USD' : 'GBP',
    amount: 1250.5 + i * 337.25,
    status: app ? null : 'CONFIRMED',
    src: app ? 'app' : 'jes',
  })
}

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
  customerOrderHistoryApi: `
    export const myOrderHistory = async () => ({ rows: [], shared: false });
  `,
  salesInvoiceHistory: `
    const ROWS = ${JSON.stringify(ROWS)};
    export const mergeSalesInvoiceHistory = () => ROWS;
  `,
}
const map = {
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
  'customerOrderHistoryApi': /(^|\/)customerOrderHistoryApi$/,
  'salesInvoiceHistory': /(^|\/)salesInvoiceHistory$/,
}
const stubPlugin = { name: 'qa-stubs', setup(b) {
  for (const [k, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: k, namespace: 'qa-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
}}

await build({
  entryPoints: ['qa/orders-preview.jsx'],
  bundle: true, outfile: 'qa/orders-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/orders-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — OrderHistoryPage</title><link rel="stylesheet" href="./orders-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./orders-preview-seeded.js"></script></body></html>`)
console.log('built qa/orders-preview-seeded.{js,css,html}')
