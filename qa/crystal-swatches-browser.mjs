import {createRequire} from 'node:module'
import {mkdir,writeFile,readdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const require=createRequire(new URL('../.qa-playwright/package.json',import.meta.url)),{chromium}=require('playwright-core')
const browser=await chromium.launch({channel:'chrome',headless:true}), context=await browser.newContext(), page=await context.newPage()
const errors=[];page.on('pageerror',e=>errors.push(e.message))
await mkdir('qa/out/swatch-v819',{recursive:true})
const report=[]
try {
 for(const width of [320,375,414,1280]) {
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:5201');await page.getByRole('button',{name:'Upload swatch',exact:true}).waitFor()
  await page.locator('img').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.getByRole('button',{name:'Upload swatch',exact:true}).click();await page.getByRole('dialog').waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(width===375 || width===1280)await page.screenshot({path:`qa/out/swatch-v819/uploader-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'Close swatch editor'}).click();report.push({width,admin:'PASS',uploader:'PASS'})
  await page.goto('http://127.0.0.1:5201?view=portal');await page.getByRole('heading',{name:'Swatch Library'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  report.at(-1).portal='PASS'
 }
 await page.goto('http://127.0.0.1:5201');await page.getByRole('button',{name:'Upload swatch',exact:true}).click()
 const files=await readdir('migration/crystal-swatches-v819.local/data/colors'),photo=files.find(p=>p.endsWith('.jpg'))
 await page.locator('input[type=file]').setInputFiles('migration/crystal-swatches-v819.local/data/colors/'+photo)
 await page.getByLabel('Crystal colour / effect').fill('QA new colour');await page.getByLabel('Backing colour / label').fill('Clear')
 await page.evaluate(()=>{window.__saveFail=true});await page.getByRole('button',{name:'Save swatch',exact:true}).click();await page.getByRole('alert').filter({hasText:'interrupted'}).waitFor()
 assert.equal(await page.getByLabel('Crystal colour / effect').inputValue(),'QA new colour')
 await page.getByRole('button',{name:'Crop photo (optional)'}).click();await page.getByRole('button',{name:'Use crop',exact:true}).click()
 await page.getByRole('button',{name:'Save swatch',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'})
 assert.equal(await page.evaluate(()=>window.__lastSave.values.publication),'draft')
 assert.ok(await page.getByText('QA new colour · Crystal Fabric · Clear').isVisible())
 await page.goto('http://127.0.0.1:5201?view=portal');await page.getByText('Crystal AB',{exact:true}).click()
 await page.getByRole('button',{name:'Add sample request to enquiry'}).waitFor();assert.ok(await page.getByRole('button',{name:'Add sample request to enquiry'}).isDisabled())
 await page.getByLabel('Photographed sample').selectOption('sw_'+'1'.repeat(64));await page.getByRole('button',{name:'Add sample request to enquiry'}).click()
 const line=await page.evaluate(()=>window.__cart[0]);assert.equal(line.swatch_sample_id,'sw_'+'1'.repeat(64));assert.equal(line.color,'Black');assert.equal(line.finish,'Fine Rock / Rock')
 await page.goto('http://127.0.0.1:5201?staff=1');await page.getByRole('button',{name:'Upload swatch',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Import Fly backup'}).count(),0)
 await page.goto('http://127.0.0.1:5201?dense=1');await page.getByText('Crystal AB',{exact:true}).click();await page.getByRole('button',{name:'Close swatch details'}).waitFor()
 await page.waitForTimeout(300);const reads=await page.evaluate(()=>window.__photoReads);assert.ok(reads<35,'large detail should not fetch all 48 photographs')
 await page.getByRole('button',{name:'Close swatch details'}).click()
 await page.route('**/photo.jpg*',async route=>{await new Promise(r=>setTimeout(r,2000));await route.continue().catch(()=>{})})
 await page.getByText('Crystal AB',{exact:true}).click();await page.waitForTimeout(300);await page.getByRole('button',{name:'Close swatch details'}).click()
 assert.ok(await page.evaluate(()=>window.__abortedReads)>0,'closing detail cancels unfinished photograph reads')
 await page.goto('http://127.0.0.1:5201?error=1');await page.getByText('Offline; please retry.').waitFor()
 assert.deepEqual(errors,[])
 const result={responsive:report,upload_error_retry:'PASS',optional_crop:'PASS',new_upload_draft:'PASS',exact_sample_selection:'PASS',staff_import_hidden:'PASS',page_error_state:'PASS',large_group_lazy_reads:reads,closed_detail_cancels_reads:'PASS',runtime_errors:errors}
 await writeFile('qa/out/swatch-v819/browser-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{await browser.close()}
