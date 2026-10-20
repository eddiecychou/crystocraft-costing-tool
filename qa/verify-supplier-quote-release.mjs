// Fresh real-page role gate. View-only quote checks; never saves live quote data.
import {createRequire} from 'node:module'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {decodeFirestore} from '../scripts/lib/swatch-read-only.mjs'
import assert from 'node:assert/strict'
const base=process.argv[2]
if(!base?.startsWith('https://'))throw Error('HTTPS URL required')
const baseline=JSON.parse(await readFile('migration/supplier-quote-precision-v819.local/before.json','utf8'))
const quote=decodeFirestore({mapValue:{fields:baseline.quote.fields}})
const quotePath='/products/mcp_45b9a093c294afa3cf113dac7df86d0f509a584c/components/mcp_45b9a093c294afa3cf11/quotes/mcp_3dac7df86d0f509a584c'
const require=createRequire(process.cwd()+'/.qa-playwright/package.json'),{chromium}=require('playwright-core'),secrets=await readFile('.env.local','utf8'),env={}
for(const key of ['QA_ADMIN_EMAIL','QA_ADMIN_PASSWORD','QA_CUSTOMER_EMAIL','QA_CUSTOMER_PASSWORD']){const m=secrets.match(new RegExp('^'+key+'=(.*)$','m'));if(!m)throw Error('Missing QA credential '+key);env[key]=m[1].trim().replace(/^(['"])(.*)\1$/,'$2')}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-quic']}),out='qa/out/supplier-quote-precision',report={url:base,checked_at:new Date().toISOString(),roles:[]}
await mkdir(out,{recursive:true})
try{
 for(const role of ['ADMIN','CUSTOMER']){
  const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/permission-denied|FirebaseError|ChunkLoadError|Failed to fetch dynamically imported/.test(m.text()))errors.push(m.text())})
  const go=async path=>{for(let n=0;n<2;n++){try{return await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000})}catch(e){if(n||!/net::ERR_/.test(e.message))throw e}}}
  await go('/login');await page.locator('input[type=email]').fill(env['QA_'+role+'_EMAIL']);await page.locator('input[type=password]').fill(env['QA_'+role+'_PASSWORD']);await page.locator('form button[type=submit]').click();await page.waitForURL(u=>u.pathname!=='/login',{timeout:60000});assert.ok(new URL(page.url()).pathname.startsWith(role==='ADMIN'?'/dashboard':'/shop'))
  const result={role:role.toLowerCase(),identity:env['QA_'+role+'_EMAIL'],fresh_password_login:'PASS',routing:'PASS'}
  console.log(role,'fresh password sign-in PASS')
  if(role==='ADMIN'){
   await page.getByRole('heading',{name:'Customer to-do list',exact:true}).waitFor({timeout:60000});await page.locator('section[aria-label^="Summary and to-do"]').first().waitFor({timeout:60000});assert.ok(await page.locator('a[href="/settings"]').count());assert.ok(await page.locator('a[href="/portal"]').count())
   await go('/products');await page.getByRole('heading',{name:'Products',exact:true}).waitFor();await page.locator('a[href^="/products/"]').filter({has:page.locator('img')}).first().waitFor({timeout:60000})
   await go(quotePath);await page.getByRole('heading',{name:'Edit Supplier Quote',exact:true}).waitFor({timeout:60000})
   const main=page.locator('input[step="0.001"]').first();assert.equal(await main.inputValue(),'1.222');assert.equal(await main.getAttribute('placeholder'),'0.000');assert.ok(await main.evaluate(el=>el.checkValidity()));assert.equal(await page.locator('input[placeholder="e.g. 200"]').inputValue(),'1000');assert.equal(await page.locator('input[step="0.01"]').inputValue(),'155');assert.ok(await page.locator('#preferred').isChecked());assert.equal(await page.locator('textarea').inputValue(),quote.notes)
   assert.equal(await main.locator('..').locator('select').inputValue(),'USD');assert.equal(await page.locator('input[step="0.01"]').locator('..').locator('select').inputValue(),'USD')
   await page.getByRole('button',{name:'Choose supplier file',exact:true}).click();await page.locator('li').filter({hasText:'飞鸿不锈钢水果叉报价.pdf'}).waitFor({timeout:60000})
   for(const width of [320,375,414,1280]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow at '+width);if(width===375||width===1280)await page.screenshot({path:out+'/admin-'+width+'-'+new URL(base).hostname+'.png'})}
   await page.reload();await page.getByRole('heading',{name:'Edit Supplier Quote',exact:true}).waitFor({timeout:60000});assert.equal(await main.inputValue(),'1.222');assert.equal(await page.locator('textarea').inputValue(),quote.notes)
   Object.assign(result,{dashboard_and_catalogue:'PASS',admin_navigation:'PASS',exact_quote_values:'PASS',supplier_file_picker:'PASS',refresh:'PASS',widths:[320,375,414,1280],live_quote_save:false})
  }else{
   await go('/shop/figurine');await page.getByRole('heading',{name:'Crystocraft Range',exact:true}).waitFor({timeout:60000});const product=page.locator('a[href^="/shop/figurine/"]').first();await product.waitFor({timeout:60000});await product.click();await page.locator('h1').waitFor();assert.equal(await page.locator('a[href="/settings"]').count(),0);assert.equal(await page.locator('input[step="0.001"]').count(),0);await page.reload();await page.locator('h1').waitFor();await page.screenshot({path:out+'/customer-'+new URL(base).hostname+'.png'})
   await go(quotePath);await page.waitForURL(u=>u.pathname.startsWith('/shop'),{timeout:30000});assert.equal(await page.getByRole('heading',{name:'Edit Supplier Quote',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Choose supplier file',exact:true}).count(),0)
   Object.assign(result,{catalogue_and_detail:'PASS',refresh:'PASS',internal_quote_refused:'PASS',supplier_cost_controls_absent:'PASS'})
  }
  assert.deepEqual(errors,[]);result.runtime_errors=errors;report.roles.push(result);console.log(role,'data, access, refresh and feature checks PASS');await context.close()
 }
 await writeFile(out+'/release-'+new URL(base).hostname+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await browser.close()}
