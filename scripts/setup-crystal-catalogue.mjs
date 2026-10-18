// Owner-requested initial business catalogue, through the real reviewed OC editor.
// Defaults to a manifest preview. --apply creates only these three named own parts.
// No service-account writer, no stock movement, no original-brand/clearance import.
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const dir='migration/crystal-catalogue-v819.local',rows=JSON.parse(await readFile(dir+'/own-products-reviewed.json','utf8'))
assert.deepEqual(rows.map(r=>r.code),['CC-OCTAGON-14','CC-HEART-14','CC-PEAR-22'])
if(!process.argv.includes('--apply')){console.log(JSON.stringify(rows.map(({code,name,shape,size,reference,holes,source_url,image_url,sha256})=>({code,name,shape,size,reference,holes,source_url,image_url,sha256})),null,2));process.exit(0)}
const base=process.argv[2];if(new URL(base).protocol!=='https:'||!new URL(base).hostname.endsWith('--ua-product-manager.netlify.app')||new URL(base).origin!==base)throw Error('Use the verified candidate URL.')
const require=createRequire(new URL('../.qa-playwright/package.json',import.meta.url)),{chromium}=require('playwright-core')
const env=await readFile('.env.local','utf8'),secret=key=>env.match(new RegExp('^'+key+'=(.*)$','m'))?.[1]?.trim().replace(/^(['"])(.*)\1$/,'$2')
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-quic']}),ctx=await browser.newContext({viewport:{width:1280,height:1000}}),page=await ctx.newPage(),records=[]
const go=async path=>{for(let n=0;n<2;n++){try{await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000});return}catch(e){if(n||!/net::ERR_/.test(e.message))throw e}}}
async function settled(button){await page.waitForTimeout(500);await button.waitFor();await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.disabled&&/Saving|Uploading/.test(b.textContent)),null,{timeout:120000});const error=await page.getByRole('alert').allTextContents();if(error.length)throw Error(error.join('; '))}
try{
 await go('/login');await page.locator('input[type=email]').fill(secret('QA_ADMIN_EMAIL'));await page.locator('input[type=password]').fill(secret('QA_ADMIN_PASSWORD'));await page.locator('form button[type=submit]').click();await page.waitForURL(u=>u.pathname.startsWith('/dashboard'),{timeout:60000})
 for(const row of rows){
  await go('/crystal-components');await page.getByRole('heading',{name:'Crystal Components',exact:true}).waitFor()
  const existing=page.locator('a[href^="/crystal-components/cp_"]').filter({hasText:row.code})
  if(await existing.count()){
   const href=await existing.first().getAttribute('href');await go(href)
   await page.getByRole('heading',{name:'Edit component',exact:true}).waitFor()
   assert.equal(await page.getByLabel('Catalogue code').inputValue(),row.code)
   assert.equal(await page.getByLabel('Product name').inputValue(),row.name)
   if(await page.getByLabel('Visibility').inputValue()==='published'){records.push({code:row.code,id:href.split('/').pop(),state:'existing published; preserved'});continue}
  }else{
   await page.getByRole('link',{name:'New component',exact:true}).click();await page.getByRole('heading',{name:'New component',exact:true}).waitFor()
   await page.getByLabel('Catalogue code').fill(row.code);await page.getByLabel('Product name').fill(row.name);await page.getByLabel('Shape').fill(row.shape);await page.getByLabel('Comparison reference (optional)').fill(row.reference);await page.getByLabel('Description / confirmed applications').fill(row.description)
   await page.getByRole('button',{name:'Create draft',exact:true}).click();await page.getByRole('heading',{name:'Edit component',exact:true}).waitFor({timeout:60000})
  }
  const id=new URL(page.url()).pathname.split('/').pop()
  if(await page.getByLabel('Cover photograph').locator('option').count()===1){
   await page.getByLabel('Product photograph').setInputFiles(row.file);await page.getByLabel('Photograph description').fill(row.name+' · Clear · Crystocraft')
   await page.getByRole('button',{name:'Upload photograph',exact:true}).click();await settled(page.getByRole('button',{name:'Upload photograph',exact:true}))
  }
  await page.getByLabel('Cover photograph').locator('option').nth(1).waitFor({state:'attached'})
  if(await page.getByLabel('Primary variant').locator('option').count()===1){
  await page.getByRole('button',{name:'Add variant',exact:true}).click();await page.getByLabel('Variant code').fill(row.code+'-CLEAR');await page.getByLabel('Variant description').fill('Clear · '+row.name);await page.getByLabel('Size / dimensions').fill(row.size);await page.getByLabel('Crystal colour').fill('Clear');await page.getByLabel('Number of holes').fill(row.holes)
  await page.getByLabel('Confirmed real combination; not generated from all possible options').check();await page.getByLabel('Variant visibility').selectOption('published');await page.getByRole('button',{name:'Save variant',exact:true}).click()
  await page.getByRole('button',{name:'Cancel variant',exact:true}).waitFor({state:'detached',timeout:60000})
  }
  await page.getByLabel('Cover photograph').selectOption({index:1});await page.getByLabel('Primary variant').selectOption({index:1})
  // Review the real saved photograph and explicit specification before publication.
  await page.locator('img[src^="blob:"]').first().waitFor({timeout:60000})
  await page.screenshot({path:dir+'/'+row.code+'-reviewed.png',fullPage:true})
  assert.equal(await page.getByLabel('Catalogue code').inputValue(),row.code)
  await page.getByLabel('Visibility').selectOption('published');await page.getByRole('button',{name:'Save component',exact:true}).click();await settled(page.getByRole('button',{name:'Save component',exact:true}))
  records.push({code:row.code,id,state:'published',source_url:row.source_url,original_sha256:row.sha256})
  await writeFile(dir+'/created-own-products.json',JSON.stringify(records,null,2))
  console.log(row.code,'reviewed and saved through OC')
 }
 await writeFile(dir+'/created-own-products.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records))
}catch(e){await page.screenshot({path:dir+'/setup-failure.png',fullPage:true});console.log('Setup stopped:',await page.getByRole('alert').allTextContents());throw e}finally{await browser.close()}
