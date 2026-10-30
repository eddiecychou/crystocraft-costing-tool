// Actual print page with isolated data. No Auth, OC reads or OC writes.
// node qa/catalogue-layout-preview.mjs [--real]
// --real uses an existing, ignored, read-only fixture from qa/out/.
import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url)), out = root + '/qa/out/catalogue-layout'
await mkdir(out, { recursive: true })
const image = (n, width = 500, height = 500) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="white" stroke="#6e2433" stroke-width="8"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#f7eee3"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="40">${n}</text><text x="50%" y="85%" text-anchor="middle" font-family="Arial" font-size="18">${width} × ${height} · full border visible</text></svg>`)
const product = (n, count = 1, specs = 'Material: crystal\nSize: 14 × 14 mm') => ({ id: String(n), product_name: `Crystal product ${n}`, product_category: 'Crystal components', marketing_description: 'A product introduction with complete photographs and specifications.', product_description: specs, selected_images: Array.from({ length: count }, (_, i) => image(`${n}.${i + 1}`, i % 3 === 1 ? 320 : 500, i % 3 === 2 ? 280 : 500)), sort_order: n })
const cases = {
  overview: [1, 2, 3, 4].map(n => product(n)),
  mixed: [product(1, 4), product(2, 3), product(3, 6)],
  many: [product(1, 15), product(2, 8)],
  long: [{ ...product(1, 13, ('晶體規格 Crystal specification 💎\nMaterial: crystal glass\nSize: 14 × 14 × 8 mm\n' + 'UnbrokenSpecification'.repeat(12) + '\n\n').repeat(25)), marketing_description: 'Full marketing introduction. '.repeat(80) }, product(2, 1)],
  noimages: [product(1, 0, 'Text-only specifications\n'.repeat(160))],
  broken: [{ ...product(1), selected_images: ['data:image/png;base64,broken'] }],
  heading: [{ ...product(1), product_name: 'Exceptionally long heading '.repeat(1000) }],
}
const sized = product(1, 10)
sized.product_name = 'Infographic and image sizing QA'
sized.selected_images[3] = image('Tall infographic', 800, 1500)
sized.selected_images[5] = image('Wide infographic', 1600, 900)
sized.hero_image = sized.selected_images[0]
sized.product_images = sized.selected_images.slice(1)
sized.image_layouts = [
  { url: sized.selected_images[1], size: 'large' }, { url: sized.selected_images[2], size: 'large' },
  { url: sized.selected_images[3], size: 'full' }, { url: sized.selected_images[5], size: 'full' },
]
cases.sizing = [sized]
const catalogue = { name: 'Flexible Catalogue QA', season: 'Layout verification', tagline: 'Local test data', cover_text_color: 'black' }
if (process.argv.includes('--real')) {
  const real = JSON.parse(await readFile(root + '/qa/out/catalogue-image-fit/fixture.json', 'utf8'))
  cases.real = real.items
  Object.assign(catalogue, real.catalogue)
}
const stub = `import React from 'react';export const db={};const cases=${JSON.stringify(cases)},catalogue=${JSON.stringify(catalogue)};
const chosen=new URLSearchParams(location.search).get('case')||('real'in cases?'real':'mixed'),key='catalogue-sizing-qa-v1-'+chosen;
let rows=JSON.parse(localStorage.getItem(key)||'null')||cases[chosen]||cases.mixed;
const listeners=new Set(),docs=()=>rows.map(i=>({id:i.id,data:()=>({...i})}));
const changed=()=>{localStorage.setItem(key,JSON.stringify(rows));listeners.forEach(cb=>cb({docs:docs()}))};
export const useParams=()=>({id:'local'}),useNavigate=()=>()=>{};
export const Link=({to,children,...p})=>React.createElement('a',{...p,href:'?case='+chosen+(to.endsWith('/preview')?'':'&builder=1')},children);
export const doc=(...a)=>a,collection=(...a)=>a,query=x=>x,orderBy=()=>{},serverTimestamp=()=> 'LOCAL-QA';
export const getDoc=async()=>({exists:()=>true,id:'local',data:()=>catalogue}),getDocs=async()=>({docs:docs()});
export const onSnapshot=(ref,cb)=>{listeners.add(cb);cb({docs:docs()});return()=>listeners.delete(cb)};
export const updateDoc=async(ref,patch)=>{Object.assign(rows.find(i=>i.id===ref.at(-1)),patch);changed()};
let queue=Promise.resolve();export const runTransaction=(db,work)=>{const result=queue.then(async()=>{const writes=[];const result=await work({get:async ref=>{const row=rows.find(i=>i.id===ref.at(-1));return{exists:()=>!!row,data:()=>row}},update:(ref,patch)=>writes.push([ref,patch])});writes.forEach(([ref,patch])=>Object.assign(rows.find(i=>i.id===ref.at(-1)),patch));changed();return result});queue=result.catch(()=>{});return result};
export const addDoc=async()=>{throw Error('No live writes in local QA')},deleteDoc=async()=>{throw Error('No live deletes in local QA')};
export const PRODUCT_SOURCES=[{value:'corporate',label:'Corporate Gifts'}],loadBlogProducts=async()=>[],loadBlogImages=async()=>[];
`
await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/pages/CataloguePreview.jsx';import Builder from './src/pages/CatalogueDetail.jsx';const View=new URLSearchParams(location.search).has('builder')?Builder:Page;createRoot(document.getElementById('root')).render(<><View/><nav className="no-print" style={{position:'fixed',bottom:4,left:4,zIndex:99,background:'white',padding:8,fontSize:12}}>Local QA · ${Object.keys(cases).map(key => `<a href="?case=${key}">${key}</a>`).join(' · ')}</nav></>);` }, outfile: out + '/app.js', bundle: true, format: 'esm', jsx: 'automatic', loader: { '.png': 'dataurl', '.ttf': 'dataurl' }, plugins: [{ name: 'isolated-reads', setup(b) {
  b.onResolve({ filter: /^(react-router-dom|firebase\/firestore)$|(^|\/)(firebase|productSource)$/ }, () => ({ path: 'stub', namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: stub, loader: 'js', resolveDir: root }))
} }] })
execFileSync(root + '/node_modules/.bin/tailwindcss', ['-i', root + '/src/index.css', '-o', out + '/style.css'], { stdio: 'pipe' })
if (process.argv.includes('--build-only')) process.exit(0)
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname
  if (['/app.js', '/style.css'].includes(path)) {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(await readFile(out + path))
  } else {
    res.setHeader('Content-Type', 'text/html;charset=utf-8')
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
console.log('Isolated catalogue QA: http://127.0.0.1:' + server.address().port)
