// Headless preview of BrandPortalPage (/shop/brand-portal) — login-gated.
// esbuild-bundles the real component with the customerAssets / customerProposal
// data layer stubbed + seeded. See UI-POLISH.md §4a.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'

const mkImg = (label, fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">' +
  '<rect width="640" height="640" fill="' + fill + '"/>' +
  '<text x="320" y="330" font-size="34" fill="#fff" text-anchor="middle" font-family="sans-serif">' + label + '</text>' +
  '</svg>')

const HERO = mkImg('HERO', '#5b1c29')
const GALLERY_ASSETS = [
  { id: 'ga1', category: 'product_gallery', filename: 'lookbook-cover.jpg', file_url: mkImg('GALLERY 1', '#996632'), title: 'Lookbook cover', type: 'photo' },
  { id: 'ga2', category: 'product_gallery', filename: 'spec-sheet.pdf', file_url: '', title: 'Spec sheet', type: 'document' },
]
const BRAND_ASSETS = [
  { id: 'b1', category: 'brand_asset', filename: 'sunlife-logo.png', file_url: mkImg('LOGO', '#1C4F64'), title: 'Primary logo', type: 'logo' },
  { id: 'b2', category: 'brand_asset', filename: 'brand-guidelines.pdf', file_url: '', title: 'Brand guidelines 2026', type: 'document' },
]
const BRANDED_IMAGES = [
  { id: 'bi1', product_id: 'p101', product_name: 'Etched Crystal Award', caption: 'Etched Crystal Award', file_url: mkImg('PRODUCT A', '#6e2433') },
  { id: 'bi2', product_id: 'p102', product_name: 'Desk Globe Paperweight', caption: '', file_url: mkImg('PRODUCT B', '#7A4F26') },
  { id: 'bi3', product_id: 'p103', product_name: 'Faceted Keepsake Box', caption: '', file_url: mkImg('PRODUCT C', '#163B4B') },
]
const SECTION_IMAGES = [
  { id: 's-img1', file_url: mkImg('STORY 1', '#8b3347'), title: 'On the awards night', caption: 'Presented to regional partners at the annual conference.', product_id: 'p101' },
  { id: 's-img2', file_url: mkImg('STORY 2', '#A88D4F'), title: 'Gift box detail', caption: '', product_id: null },
]
const SECTION_PRODUCTS = [
  { collection: 'products', id: 'p104', to: '/shop/corporate/p104', image: mkImg('PICK 1', '#501829'), name: 'Optical Crystal Obelisk', caption: 'Deep-etched 3D logo, satin-lined box.' },
  { collection: 'products', id: 'p105', to: '/shop/corporate/p105', image: mkImg('PICK 2', '#2A6A84'), name: 'Recognition Star', caption: '' },
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
    export const onSnapshot = () => () => {};
    export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
    export const getDocs = async () => ({ docs: [], forEach: () => {} });
    export const setDoc = async () => {}; export const addDoc = async () => ({ id: 'x' });
    export const deleteDoc = async () => {}; export const updateDoc = async () => {};
    export const serverTimestamp = () => null;
  `,
  customerAssets: `
    const GALLERY_ASSETS = ${JSON.stringify(GALLERY_ASSETS)};
    const BRAND_ASSETS = ${JSON.stringify(BRAND_ASSETS)};
    const BRANDED_IMAGES = ${JSON.stringify(BRANDED_IMAGES)};
    export const loadCustomerVisibleAssets = async () => [...GALLERY_ASSETS, ...BRAND_ASSETS];
    export const loadBrandedProductImages = async () => BRANDED_IMAGES;
    export const cannotRenderAsImage = (fn) => !/\\.(png|jpe?g|gif|webp|svg)$/i.test(fn || '');
    export const TYPE_LABEL = { logo: 'Logo', document: 'Document', photo: 'Photo' };
  `,
  customerProposal: `
    const HERO = ${JSON.stringify(HERO)};
    const SECTION_IMAGES = ${JSON.stringify(SECTION_IMAGES)};
    const SECTION_PRODUCTS = ${JSON.stringify(SECTION_PRODUCTS)};
    export const loadProposal = async () => ({
      status: 'published',
      tagline: 'Crystal that carries your brand',
      briefing: 'A curated set of optical-crystal gifts prepared for Sun Life — recognition awards, desk pieces and keepsakes, each ready to carry your mark.',
      hero_asset_id: 'hero-1',
      sections: [
        { heading: 'The recognition story', tagline: 'Milestones, made tangible',
          briefing: 'Pieces chosen for annual awards and partner appreciation.',
          asset_ids: ['s-img1', 's-img2'], product_refs: [{ collection: 'products', id: 'p104' }] },
        { heading: 'Ready to personalise', tagline: 'Your logo, deep-etched',
          briefing: '', asset_ids: [], product_refs: [{ collection: 'products', id: 'p105' }] },
      ],
    });
    export const resolveProposalAsset = () => ({ file_url: HERO });
    export const resolveProposalAssetIds = (_m, ids) =>
      (ids || []).map(id => SECTION_IMAGES.find(s => s.id === id)).filter(Boolean);
    export const resolveProductRefs = async (refs) =>
      (refs || []).map(r => SECTION_PRODUCTS.find(p => p.id === r.id)).filter(Boolean);
    export const hasBrandPortalContent = async () => true;
  `,
  brandProposalExport: `
    export const buildBrandProposalPdf = async () => { await new Promise(r => setTimeout(r, 400)); };
  `,
}
const map = {
  'firebase': /(^|\/)firebase$/, 'firestore': /^firebase\/firestore$/,
  'customerAssets': /(^|\/)customerAssets$/,
  'customerProposal': /(^|\/)customerProposal$/,
  'brandProposalExport': /(^|\/)brandProposalExport$/,
}
const stubPlugin = { name: 'qa-stubs', setup(b) {
  for (const [k, re] of Object.entries(map)) b.onResolve({ filter: re }, () => ({ path: k, namespace: 'qa-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, a => ({ contents: STUBS[a.path], loader: 'js', resolveDir: process.cwd() }))
}}

await build({
  entryPoints: ['qa/brand-portal-preview.jsx'],
  bundle: true, outfile: 'qa/brand-portal-preview-seeded.js', format: 'esm', jsx: 'automatic',
  loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.ttf': 'file', '.css': 'css' },
  define: { 'import.meta.env.VITE_FIREBASE_API_KEY': '"x"', 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})
writeFileSync('qa/brand-portal-preview-seeded.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — BrandPortalPage</title><link rel="stylesheet" href="./brand-portal-preview-seeded.css"></head><body><div id="root"></div><script type="module" src="./brand-portal-preview-seeded.js"></script></body></html>`)
console.log('built qa/brand-portal-preview-seeded.{js,css,html}')
