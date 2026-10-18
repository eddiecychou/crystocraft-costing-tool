import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const require=createRequire(new URL('../.qa-playwright/package.json',import.meta.url)),{chromium}=require('playwright-core')
const browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({acceptDownloads:true}),page=await ctx.newPage(),errors=[],out='qa/out/crystal-components-v819'
page.on('pageerror',e=>errors.push(e.message));await mkdir(out,{recursive:true})
const url=path=>'http://127.0.0.1:5202'+path,go=async path=>{await page.goto(url(path));await page.locator('h1').waitFor()},noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,page.url())
const results=[]
try{
 for(const width of [320,375,414,1280]){
  await page.setViewportSize({width,height:900})
  for(const path of ['/crystal-components','/crystal-components/cp_original_example','/crystal-components/new','/shop/crystal-components','/shop/crystal-components/cp_original_example','/shop/crystal-components/cp_fabric_example']){
   await go(path);await noOverflow()
   if(path.includes('/shop/crystal-components/')){assert.ok(await page.getByRole('button',{name:'Request a quote',exact:true}).isDisabled());await page.getByLabel('Select an actual variant').selectOption('v_clear_example');await page.getByText('10 pieces available · subject to confirmation.',{exact:true}).waitFor();await noOverflow()}
   if((width===375||width===1280)&&path==='/shop/crystal-components/cp_original_example')await page.screenshot({path:out+'/clearance-'+width+'.png',fullPage:true})
  }
  results.push({width,pages:6,overflow:false})
 }
 await page.setViewportSize({width:375,height:900})
 await go('/shop/crystal-components')
 await page.getByRole('button',{name:'Original Swarovski Stock',exact:true}).click()
 assert.equal(await page.locator('a[href^="/shop/crystal-components/cp_"]').count(),1)
 await go('/shop/crystal-components/cp_fabric_example')
 await page.getByLabel('Select an actual variant').selectOption('v_clear_example')
 await page.getByLabel('Photographed reference (optional)').selectOption('sw_photo_example')
 await page.getByLabel('Intended application').fill('Hotel lighting panel')
 await page.getByLabel('Requested quantity (projects)').fill('3')
 await page.getByRole('button',{name:'Request a quote',exact:true}).click()
 let cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('cc_cart')))
 assert.equal(cart[0].variant_id,'v_clear_example');assert.equal(cart[0].unit,'project');assert.equal(cart[0].swatch_sample_id,'sw_photo_example');assert.equal(cart[0].application,'Hotel lighting panel')
 await page.getByLabel('Select an actual variant').selectOption('v_blue_example');await page.getByRole('button',{name:'Request a quote',exact:true}).click()
 cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('cc_cart')));assert.equal(cart.length,2);assert.notEqual(cart[0].key,cart[1].key)
 // A new sample/backing request for the same variant remains a different line.
 await page.getByLabel('Select an actual variant').selectOption('v_clear_example');await page.getByRole('button',{name:'Request a quote',exact:true}).click()
 cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('cc_cart')));assert.equal(cart.length,3)
 await page.getByRole('link',{name:'Enquiry',exact:true}).click();await page.getByText('On quotation',{exact:true}).waitFor();await noOverflow()
 await page.screenshot({path:out+'/enquiry-375.png',fullPage:true})
 await page.getByLabel('Drawing / reference file (optional)').setInputFiles({name:'Application drawing.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 fictional QA')})
 await page.getByRole('button',{name:'Send enquiry',exact:true}).click();await page.getByRole('heading',{name:'Enquiry sent',exact:true}).waitFor()
 const write=await page.evaluate(()=>window.__writes.find(w=>w.path.startsWith('enquiries/')))
 assert.ok(write);assert.equal(write.value.estimated_total,null);assert.equal(write.value.items[0].source_collection,'crystal_products');assert.equal(write.value.items[0].unit,'project');assert.equal(write.value.items[0].variant_revision,2);assert.equal(write.value.items[0].swatch_revision,4);assert.equal(write.value.attachments[0].name,'Application drawing.pdf');assert.equal(write.value.items[0].application,'Hotel lighting panel')
 await go('/shop/crystal-components/cp_own_example');await page.getByRole('button',{name:'Save to favourites',exact:true}).click();await page.getByRole('link',{name:'Favourites',exact:true}).click()
 assert.equal(await page.locator('a[href="/shop/crystal-components/cp_own_example"]').count(),3)
 assert.equal(await page.getByRole('button',{name:'Add to enquiry',exact:true}).count(),0)
 await go('/crystal-components/cp_original_example');await page.getByRole('button',{name:'Review stock link',exact:true}).first().click()
 await page.getByLabel('I verified the exact stock identity, unit conversion and current count for availability.').check();await page.getByRole('button',{name:'Save stock link',exact:true}).click()
 const mapping=await page.evaluate(()=>window.__lastMapping);assert.equal(mapping.inventory_id,'stock_original_example');assert.equal(mapping.reviewed,true)
 const stock=await page.evaluate(()=>window.__records['crystals/stock_original_example']);assert.equal(stock.stock_qty,12);assert.equal(stock.reserved_qty,2)
 await go('/shop/crystal-components?empty=1');await page.getByText('More components are being prepared',{exact:true}).waitFor()
 await go('/shop/crystal-components?error=1');await page.getByRole('alert').waitFor()
 assert.deepEqual(errors,[])
 const report={responsive:results,clearance_filter:'PASS',exact_variant_and_sample:'PASS',distinct_cart_lines:'PASS',enquiry_snapshot_and_private_drawing:'PASS',unpriced_total:'PASS',favourite_routing:'PASS',reviewed_stock_mapping_without_movement:'PASS',empty_error_states:'PASS',runtime_errors:errors}
 await writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(e){console.log('DIAG',await page.locator('[role=alert]').allTextContents(),await page.evaluate(()=>window.__writes),errors);await page.screenshot({path:out+'/failure.png',fullPage:true});throw e}finally{await browser.close()}
