// Builds qa/home-preview-seeded.html — the customer HomePage with the
// Firestore-backed hooks SEEDED with fake data (featured products, a
// published proposal), so the Featured / invite sections actually render for
// a headless before/after. Real component, stubbed data layer.
//
//   node qa/home-preview-seeded.mjs   # -> qa/home-preview-seeded.js + .html
//
// Then open http://localhost:5179/qa/home-preview-seeded.html on the dev server.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

// A SQUARE test image with its top & bottom edges labelled — makes any
// aspect-ratio crop on the Featured lead tile obvious (see the 2026-09-01
// square-image-crop fix).
const squareSvg = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">' +
  '<rect width="600" height="600" fill="#efe6d8"/>' +
  '<rect x="235" y="60" width="130" height="480" rx="14" fill="#3b3f4a"/>' +
  '<text x="300" y="52" font-size="22" fill="#8a3b52" text-anchor="middle" font-family="sans-serif">TOP EDGE</text>' +
  '<text x="300" y="575" font-size="22" fill="#8a3b52" text-anchor="middle" font-family="sans-serif">BOTTOM EDGE</text>' +
  '</svg>'
)
const IMG = `data:image/svg+xml;utf8,${squareSvg}`

const STUBS = {
  // useFrontPageFeatured -> 5 fake items (some flagged is_new via the meta stub below)
  'frontPageFeatured': `
    const IMG = ${JSON.stringify(IMG)};
    export function useFrontPageFeatured() {
      return { items: [
        { id:'f1', product_id:'p1', product_type:'range',     image_url: IMG },
        { id:'f2', product_id:'p2', product_type:'corp_gift', image_url: IMG },
        { id:'f3', product_id:'p3', product_type:'range',     image_url: IMG },
        { id:'f4', product_id:'p4', product_type:'corp_gift', image_url: IMG },
        { id:'f5', product_id:'p5', product_type:'range',     image_url: IMG },
      ] }
    }
    export const saveFrontPageFeatured = async () => {}
    export const getFrontPageFeaturedOnce = async () => ({ items: [] })
  `,
  'customerProposal': `
    export const loadProposal = async () => ({ status:'published' })
    export const CAPTION_MAX_LEN = 200
    export const hasBrandPortalContent = async () => false
  `,
  'customerAssets': `
    export const loadBrandedProductImages = async () => []
    export const loadCustomerVisibleAssets = async () => []
  `,
  // Data layer stub — getDoc resolves a fake product so useFeaturedProductsMeta
  // populates (one in ~3 flagged is_new); onSnapshot fires an empty doc once.
  'firebase': `
    export const db = {}; export const auth = { currentUser: null }; export const storage = {};
    export const authHeader = async () => ({});
    export default {};
  `,
  'firestore': `
    export const doc = (...a) => ({ a });
    export const collection = (...a) => ({ a });
    let _n = 0;
    export const getDoc = async () => { _n++; return {
      exists: () => true,
      data: () => ({ name: 'Sample Corporate Trophy ' + _n, design_name: 'Sample Figurine ' + _n, description: 'Sample', design_code: 'D000'+_n, is_new: _n % 3 === 0 }),
    }; };
    export const getDocs = async () => ({ docs: [], forEach: () => {} });
    export const onSnapshot = (ref, next) => { try { const isFav = JSON.stringify(ref).includes('favourites'); next({ exists: () => isFav, data: () => (isFav ? { items: [{type:'figurine',id:'a'},{type:'corp',id:'b'}] } : {}) }); } catch {} return () => {}; };
    export const setDoc = async () => {}; export const addDoc = async () => ({ id: 'x' });
    export const deleteDoc = async () => {}; export const updateDoc = async () => {};
    export const query = (...a) => ({ a }); export const where = (...a) => ({ a }); export const orderBy = (...a) => ({ a }); export const limit = (...a) => ({ a });
    export const serverTimestamp = () => null; export const writeBatch = () => ({ set(){}, update(){}, commit: async () => {} });
  `,
}

const stubPlugin = {
  name: 'qa-stubs',
  setup(b) {
    b.onResolve({ filter: /(^|\/)(frontPageFeatured|customerProposal|customerAssets)$/ }, args => ({
      path: args.path.split('/').pop(), namespace: 'qa-stub',
    }))
    b.onResolve({ filter: /(^|\/)firebase$/ }, () => ({ path: 'firebase', namespace: 'qa-stub' }))
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'qa-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, args => ({
      contents: STUBS[args.path], loader: 'js', resolveDir: process.cwd(),
    }))
  },
}

await build({
  entryPoints: ['qa/home-preview.jsx'],
  bundle: true,
  outfile: 'qa/home-preview-seeded.js',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})

writeFileSync('qa/home-preview-seeded.html',
`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — HomePage (seeded)</title><link rel="stylesheet" href="./home-preview-seeded.css"></head><body><div id="root"></div><script>try{localStorage.setItem("cc_cart",JSON.stringify([{type:"figurine",id:"a",qty:1},{type:"figurine",id:"b",qty:1},{type:"corp",id:"c",qty:1}]))}catch(e){}</script><script type="module" src="./home-preview-seeded.js"></script></body></html>`)
console.log('built qa/home-preview-seeded.{js,css,html}')
