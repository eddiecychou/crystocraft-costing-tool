// Fresh real-page sign-ins. Credentials stay local and are never reported.
// --import is the authorized migration through the reviewed admin screen, not
// a service-account write. Ordinary QA is read-only apart from login stamps.
import {createRequire} from 'node:module'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const base=process.argv[2];if(!base?.startsWith('https://'))throw Error('HTTPS candidate/production URL required.')
const require=createRequire(new URL('../.qa-playwright/package.json',import.meta.url)),{chromium}=require('playwright-core')
const secrets=await readFile('.env.local','utf8'),env={}
for(const key of ['QA_ADMIN_EMAIL','QA_ADMIN_PASSWORD','QA_CUSTOMER_EMAIL','QA_CUSTOMER_PASSWORD']){const match=secrets.match(new RegExp('^'+key+'=(.*)$','m'));if(!match)throw Error('Missing authorized QA credential: '+key);env[key]=match[1].trim().replace(/^(['"])(.*)\1$/,'$2')}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-quic']}),report={url:base,roles:[]},out='qa/out/swatch-v819'
await mkdir(out,{recursive:true})
try {
 for(const role of ['ADMIN','CUSTOMER']){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),page=await ctx.newPage(),errors=[]
  const navigate=async url=>{
   for(let attempt=0;attempt<2;attempt++){
    try{return await page.goto(url,{timeout:60000,waitUntil:'domcontentloaded'})}
    catch(e){if(attempt || !/net::ERR_/.test(e.message))throw e;console.log(role,'retrying navigation connection');await page.waitForTimeout(1000)}
   }
  }
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error' && /permission-denied|FirebaseError|ChunkLoadError|Failed to fetch dynamically imported/.test(m.text()))errors.push(m.text())})
  await navigate(base+'/login');await page.locator('input[type=email]').fill(env['QA_'+role+'_EMAIL']);await page.locator('input[type=password]').fill(env['QA_'+role+'_PASSWORD']);await page.locator('form button[type=submit]').click()
  await page.waitForURL(url=>url.pathname!=='/login',{timeout:60000})
  assert.ok(new URL(page.url()).pathname.startsWith(role==='ADMIN'?'/dashboard':'/shop'))
  console.log(role,'fresh real-page sign-in PASS')
  if(role==='ADMIN'){
   await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor()
   assert.ok(await page.locator('a[href="/settings"]').count()>0)
   assert.ok(await page.locator('a[href="/portal"]').count()>0)
   await navigate(base+'/products');await page.getByRole('heading',{name:'Products',exact:true}).waitFor()
   await page.locator('a[href^="/products/"]').filter({has:page.locator('img')}).first().waitFor({timeout:60000})
  }else{
   await navigate(base+'/shop/figurine');await page.getByRole('heading',{name:'Crystocraft Range',exact:true}).waitFor()
   const product=page.locator('a[href^="/shop/figurine/"]').first();await product.waitFor({timeout:60000});await product.click();await page.locator('h1').waitFor()
   assert.equal(await page.locator('a[href="/settings"]').count(),0)
   await navigate(base+'/settings');await page.waitForURL(url=>url.pathname.startsWith('/shop'),{timeout:30000})
  }
  console.log(role,'catalogue and role separation PASS')
  await navigate(base+(role==='ADMIN'?'/swatch-library':'/shop/swatches'))
  await page.getByRole('heading',{name:role==='ADMIN'?'Swatch Library':'Crystal Fabric',exact:true}).waitFor({timeout:60000})
  if(role==='ADMIN' && process.argv.includes('--import')) {
   await page.getByRole('button',{name:'Import Fly backup',exact:true}).click()
   await page.getByLabel('Verified migration ZIP').setInputFiles('migration/crystal-swatches-v819.local/swatch-migration.zip')
   await page.getByText('17 colours · 156 registered photos · 9 extra files kept private',{exact:true}).waitFor({timeout:120000})
   await page.getByText('Manifest: 8c0291ff97379d79c89e56d920704ec59c1f2309ac0477a211bada3d3862c7df',{exact:true}).waitFor()
   await page.getByText('Review sample mapping',{exact:true}).click()
   assert.equal(await page.locator('#migration-title').count(),1)
   await page.screenshot({path:out+'/migration-reviewed.png',fullPage:true})
   await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Import reviewed samples',exact:true}).click()
   let last=''
   for(let i=0;i<3600;i++){
    const alert=page.getByRole('alert');if(await alert.count()){const message=await alert.first().textContent();if(message)throw Error('Migration stopped: '+message)}
    if(await page.getByText('Import verified. The swatch pages now use the Firebase copy.',{exact:true}).isVisible())break
    const progress=await page.locator('progress').getAttribute('value').catch(()=>null);if(progress && progress!==last){console.log('Migration verified',progress,'/ 156');last=progress}
    await page.waitForTimeout(1000)
   }
   await page.getByText('Import verified. The swatch pages now use the Firebase copy.',{exact:true}).waitFor({timeout:1000})
   report.migration='PASS';await page.screenshot({path:out+'/migration-verified.png',fullPage:true})
   await page.getByRole('button',{name:'Close import',exact:true}).click()
  }
  await page.locator('img[src^="blob:"]').first().waitFor({timeout:60000})
  await page.getByText('Crystal AB',{exact:true}).click();await page.getByRole('button',{name:'Close swatch details'}).waitFor()
  if(role==='ADMIN')assert.ok(await page.getByRole('button',{name:'Edit sample'}).count()>0)
  else {await page.getByLabel('Enquiry type').selectOption('sample');assert.equal(await page.getByRole('button',{name:'Edit sample'}).count(),0);assert.ok(await page.getByRole('button',{name:'Add sample request to enquiry'}).isDisabled())}
  if(role==='CUSTOMER'){
   const choice=page.getByLabel('Photographed sample');await choice.selectOption({index:1})
   await page.getByRole('button',{name:'Add sample request to enquiry'}).click()
   const cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('cc_cart')||'[]'))
   assert.equal(cart.length,1);assert.ok(cart[0].swatch_sample_id);assert.ok(cart[0].swatch_revision)
   await navigate(base+'/shop/enquiry');await page.getByText('On quotation',{exact:true}).waitFor()
   await page.screenshot({path:out+'/sample-enquiry-'+new URL(base).hostname+'.png',fullPage:true})
   await page.getByRole('button',{name:'Remove',exact:true}).click()
   await navigate(base+'/shop/swatches');await page.getByRole('heading',{name:role==='ADMIN'?'Swatch Library':'Crystal Fabric',exact:true}).waitFor()
  }else await page.getByRole('button',{name:'Close swatch details'}).click()
  if(role==='ADMIN'){
   await page.getByRole('button',{name:'Upload swatch',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Close swatch editor'}).click()
  }else assert.equal(await page.getByRole('button',{name:'Upload swatch',exact:true}).count(),0)
  await page.reload();await page.getByRole('heading',{name:role==='ADMIN'?'Swatch Library':'Crystal Fabric',exact:true}).waitFor();await page.locator('img[src^="blob:"]').first().waitFor()
  for(const width of [320,375,414,1280]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(200)
   await page.waitForFunction(()=>{
    const cards=[...document.querySelectorAll('div.aspect-square.group')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0 && r.top<innerHeight-64 && r.bottom>0})
    return cards.length>0 && cards.every(el=>{const img=el.querySelector('img');return img?.complete && img.naturalWidth>0})
   },null,{timeout:60000})
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,role+' overflow at '+width)
   if(width===375)await page.screenshot({path:out+'/'+role.toLowerCase()+'-375-'+new URL(base).hostname.split('.')[0]+'.png',fullPage:true})
  }
  await page.screenshot({path:out+'/'+role.toLowerCase()+'-'+new URL(base).hostname.split('.')[0]+'.png',fullPage:true})
  const feature={role:role.toLowerCase(),fresh_login:'PASS',routing:'PASS',catalogue_and_detail:'PASS',swatch_data_and_photos:'PASS',access_separation:'PASS',refresh:'PASS',actual_widths:[320,375,414,1280],visible_photos:'PASS',runtime_errors:errors}
  assert.deepEqual(errors,[]);report.roles.push(feature);console.log(role,'swatch and refresh checks PASS')
  await ctx.close()
 }
 await writeFile(out+'/release-'+new URL(base).hostname+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await browser.close()}
