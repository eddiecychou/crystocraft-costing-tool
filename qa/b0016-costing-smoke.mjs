import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from '/Users/eddie/Developer/costing-tool/.qa-playwright/node_modules/playwright-core/index.mjs'
import { designDraft } from '../netlify/edge-functions/lib/mcpFigurineRange.js'
const colours=['BK','BL','C1','MT','PE','VL']
const refs=[{id:'metal',code:'FM-B0016BY00-G',qty_per_unit:1,all_variants:true},...colours.map(c=>({id:c,code:'P-CF003-'+c,qty_per_unit:1,all_variants:true,crystal_code:c}))]
const fixture={product:{...designDraft(),critical_components:refs},lib:refs.map(r=>({id:r.id,code:r.code,name:r.code,unit_cost:r.id==='metal'?11.3:9,unit_cost_currency:'RMB',tooling_sample_cost:r.id==='metal'?2912:null,tooling_sample_cost_currency:'RMB'})),writes:0}
const stubs={firebase:'export const db={};',firestore:`export const doc=(...a)=>({path:a.filter(x=>typeof x==='string').join('/')}); export const getDoc=async r=>({exists:()=>true,data:()=>r.path.startsWith('range_products/')?window.fixture.product:{RMB:1.1686,USD:7.8}});export const updateDoc=async()=>{window.fixture.writes++;throw Error('No writes in smoke test')};export const serverTimestamp=()=>0;`,components:`export const useComponents=()=>({components:window.fixture.lib});export const resolveRef=(r,lib)=>lib.find(c=>c.id===r.id||c.code===r.code);`,crystal:`export const useCrystalUnitCosts=()=>({items:[]});export const crystalSizesOf=()=>[];export const crystalBrandsForSize=()=>[];export const resolveCrystalCost=()=>null;`,pricing:'export const DEFAULT_MARKUP=2;',erp:'export const checkBomCoverage=async()=>({});'}
const mapping={firebase:/(^|\/)firebase$/,firestore:/^firebase\/firestore$/,components:/(^|\/)criticalComponents$/,crystal:/(^|\/)crystalCosting$/,pricing:/(^|\/)pricing$/,erp:/(^|\/)erpBomCoverage$/}
await build({entryPoints:['qa/b0016-costing-preview.jsx'],bundle:true,outfile:'qa/b0016-costing-preview-seeded.js',format:'esm',jsx:'automatic',loader:{'.ttf':'file','.png':'file','.jpg':'file'},plugins:[{name:'fixtures',setup(b){for(const[k,filter]of Object.entries(mapping))b.onResolve({filter},()=>({path:k,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}))}}]})
execFileSync('node_modules/.bin/tailwindcss',['-i','src/index.css','-o','qa/b0016-costing-preview-seeded.css','--content','./src/**/*.{js,jsx},./qa/b0016-costing-preview.jsx'])
writeFileSync('qa/b0016-costing-preview-seeded.html',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./b0016-costing-preview-seeded.css"></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(fixture)}</script><script type="module" src="./b0016-costing-preview-seeded.js"></script></body></html>`)
const server=createServer((req,res)=>{try{const p=join(process.cwd(),new URL(req.url,'http://x').pathname),body=readFileSync(p);res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(p)]||'application/octet-stream'});res.end(body)}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({channel:'chrome',headless:true})
let checks=0
const check=(label,ok)=>{if(!ok)throw Error(label);checks++;console.log('ok',label)}
try{
 for(const width of [375,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(`http://127.0.0.1:${server.address().port}/qa/b0016-costing-preview-seeded.html`)
  await page.getByRole('heading',{name:'Finished-product pricing unavailable'}).waitFor()
  check(`${width}: six colour subtotals`,await page.getByText(/G · (BK|BL|C1|MT|PE|VL) component subtotal/).count()===6)
  check(`${width}: price publishing disabled`,!await page.getByRole('button',{name:'Save & publish'}).isEnabled())
  check(`${width}: no finished sell table`,await page.getByRole('heading',{name:/Per-variant cost & sell/}).count()===0)
  check(`${width}: no writes`,await page.evaluate(()=>window.fixture.writes===0))
  check(`${width}: no body overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
  check(`${width}: no runtime errors`,errors.length===0)
  await page.screenshot({path:`/private/tmp/b0016-costing-${width}.png`,fullPage:false});await page.close()
 }
 console.log(`${checks} B0016 costing browser checks passed`)
}finally{await browser.close();server.close()}
