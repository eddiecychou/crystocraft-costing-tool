// Supplemental read-only shipping checks. Run the shared fresh-role checker too.
// Never save, raise/allocate an invoice, duplicate, import or touch stock controls.
import {createRequire} from 'node:module'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
const base=new URL(process.argv[2]||''),phase=process.argv[3],out=process.argv[4]||'qa/out/shipment-display'
assert.match(out,/^qa\/out\/[\w-]+$/)
const savedWooPath=process.argv[5]
if(savedWooPath)assert.match(savedWooPath,/^\/shipments\/woo-\d+$/,'Only an audited Woo order path may override the read-only saved-order sample')
assert.equal(base.protocol,'https:')
assert.ok(base.hostname==='portal.crystocraft.com'||/^[a-f0-9]{24}--ua-product-manager\.netlify\.app$/.test(base.hostname))
assert.ok(['baseline','candidate','production'].includes(phase))
const require=createRequire(new URL('../.qa-playwright/package.json',import.meta.url)),{chromium}=require('playwright-core')
const secret=await readFile('.env.local','utf8'),env={}
for(const key of ['QA_ADMIN_EMAIL','QA_ADMIN_PASSWORD','QA_CUSTOMER_EMAIL','QA_CUSTOMER_PASSWORD']){
 const m=secret.match(new RegExp('^'+key+'=(.*)$','m'));if(!m)throw Error('Missing authorized QA credential: '+key)
 env[key]=m[1].trim().replace(/^(['"])(.*)\1$/,'$2')
}
const report={origin:base.origin,phase,checkoutSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),roles:[]}
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-quic']})
try{
 for(const role of ['ADMIN','CUSTOMER']){
  const context=await browser.newContext({viewport:{width:1280,height:900}})
  try{
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(60000)
   page.on('pageerror',e=>errors.push(e.message))
   page.on('console',m=>{if(m.type()==='error'&&/permission-denied|FirebaseError|ChunkLoadError|Failed to fetch dynamically imported/.test(m.text()))errors.push(m.text())})
   const go=async path=>{for(let i=0;i<2;i++){try{return await page.goto(base.origin+path,{waitUntil:'domcontentloaded',timeout:60000})}catch(e){if(i||!/net::ERR_/.test(e.message))throw e}}}
   await go('/login');await page.locator('input[type=email]').fill(env['QA_'+role+'_EMAIL']);await page.locator('input[type=password]').fill(env['QA_'+role+'_PASSWORD']);await page.locator('form button[type=submit]').click();await page.waitForURL(u=>u.pathname!=='/login')
   assert.equal(new URL(page.url()).pathname,role==='ADMIN'?'/dashboard':'/shop')
   const result={role:role.toLowerCase(),identity:env['QA_'+role+'_EMAIL'],freshSignIn:true}
   await go('/shipments/new')
   if(role==='ADMIN'){
    await page.getByRole('heading',{name:'New Order',exact:true}).waitFor()
    await page.getByRole('heading',{name:'Document References',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Create Order',exact:true}).isDisabled(),true)
    assert.equal(await page.getByText(/found in the ERP —/).count(),0)
    result.blankOrder='PASS; no comparison before import'
    const refs=page.getByRole('heading',{name:'Document References',exact:true}).locator('..')
    const lineItems=page.getByRole('heading',{name:'Line items & reconciliation',exact:true})
    const addLine=page.getByRole('button',{name:'+ Add line',exact:true})
    const lineCodes=page.getByPlaceholder('Item code',{exact:true})
    const unclassified=page.getByText(/still need a type\. Classify every line before packing\./)
    await lineItems.waitFor()
    assert.equal(await lineCodes.count(),0)
    await addLine.click()
    assert.equal(await lineCodes.count(),1)
    assert.match(await unclassified.innerText(),/^1 line still/)
    await addLine.click()
    assert.match(await unclassified.innerText(),/^2 lines still/)
    await page.getByRole('button',{name:'Ad-hoc',exact:true}).first().click()
    assert.match(await unclassified.innerText(),/^1 line still/)
    const editedRow=lineCodes.first().locator('../../..')
    await lineCodes.first().fill('QA-ROW')
    await editedRow.getByPlaceholder('Description',{exact:true}).fill('Fictional QA row')
    await editedRow.getByPlaceholder('Tier remarks (customer-facing)',{exact:true}).fill('Fictional tier remarks')
    await editedRow.getByPlaceholder('Qty',{exact:true}).fill('3')
    await editedRow.getByPlaceholder('pcs',{exact:true}).fill('pair')
    await editedRow.getByPlaceholder('Unit price',{exact:true}).fill('1.222')
    assert.deepEqual(await editedRow.locator('input,textarea').evaluateAll(fields=>fields.map(field=>field.value)),
      ['QA-ROW','Fictional QA row','Fictional tier remarks','3','pair','1.222'])
    assert.equal(await editedRow.getByTitle('Add an image for the Proforma / Invoice',{exact:true}).count(),1)
    const destination=page.getByRole('heading',{name:'Destination',exact:true}).locator('..')
    const remarks=page.locator('textarea[placeholder^="Prints on the Proforma and Sales Invoice"]')
    const hideQuantity=page.getByRole('checkbox',{name:/Hide "Total Qty"/})
    const orderDetails=async()=>({
      destination:await destination.locator('input').evaluateAll(inputs=>inputs.map(input=>input.value)),
      remarks:await remarks.inputValue(),hideQuantity:await hideQuantity.isChecked(),
    })
    const blankDetails=await orderDetails()
    const fictionalDestination=['QA Country','QA City','QA Port']
    for(const [i,value] of fictionalDestination.entries())await destination.locator('input').nth(i).fill(value)
    await remarks.fill('Fictional unsaved QA remarks')
    await hideQuantity.setChecked(!blankDetails.hideQuantity)
    assert.deepEqual(await orderDetails(),{destination:fictionalDestination,remarks:'Fictional unsaved QA remarks',hideQuantity:!blankDetails.hideQuantity})
    const schedule=page.getByRole('heading',{name:'Schedule & Terms',exact:true}).locator('..')
    const scheduleFields=()=>schedule.locator('input,select').evaluateAll(fields=>fields.map(field=>({value:field.value,placeholder:field.getAttribute('placeholder')})))
    const originalSchedule=await scheduleFields()
    assert.equal(await schedule.locator('input[type=date]').count(),2)
    assert.equal(await schedule.getByText('Status',{exact:true}).count(),0)
    assert.ok(await schedule.locator('#payment-terms option').count())
    const dates=schedule.locator('input[type=date]'), options=schedule.locator('select')
    await dates.nth(0).fill('2026-11-04');await dates.nth(1).fill('2026-11-16')
    await options.nth(0).selectOption('EUR');await options.nth(1).selectOption('DAP')
    await schedule.locator('input[list=payment-terms]').fill('Fictional unsaved QA terms')
    assert.deepEqual((await scheduleFields()).map(field=>field.value),['2026-11-04','2026-11-16','EUR','DAP','Fictional unsaved QA terms'])
    const referenceInputs=['e.g. SO260017','e.g. UC4950/26','e.g. SI260094','e.g. 56909','Original']
    for(const placeholder of referenceInputs)assert.equal(await refs.getByPlaceholder(placeholder,{exact:true}).inputValue(),'')
    // The current buttons sit inside labels, so their accessible names include
    // the field label. Preserve that markup and select their actual text here.
    const allocateButtons=()=>refs.locator('button').filter({hasText:/^\s*Allocate\s*$/})
    assert.equal(await allocateButtons().count(),3)
    for(const [placeholder,value]of referenceInputs.slice(0,4).map((p,i)=>[p,['SO-QA-UNSAVED','UC-QA-UNSAVED','SI-QA-UNSAVED','Fictional unsaved PO 中文 &'][i]]))await refs.getByPlaceholder(placeholder,{exact:true}).fill(value)
    await refs.locator('button').filter({hasText:'+ New Rev'}).click()
    await refs.locator('button').filter({hasText:'+ New Rev'}).click()
    assert.equal(await refs.getByPlaceholder('Original',{exact:true}).inputValue(),'2')
    assert.equal(await allocateButtons().count(),0)
    await page.reload();await page.getByRole('heading',{name:'New Order',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Create Order',exact:true}).isDisabled(),true)
    for(const placeholder of referenceInputs)assert.equal(await refs.getByPlaceholder(placeholder,{exact:true}).inputValue(),'')
    assert.equal(await allocateButtons().count(),3)
    await refs.screenshot({path:`${out}/${phase}-admin-document-references.png`})
    assert.deepEqual(await scheduleFields(),originalSchedule)
    assert.deepEqual(await orderDetails(),blankDetails)
    assert.equal(await lineCodes.count(),0)
    assert.equal(await unclassified.count(),0)
    result.lineItemsHeader='PASS; add and classify on a blank form, warning count and reload reset'
    result.lineRowEditor='PASS; item code, description, tier remarks, quantity, unit, price, image control and reload reset'
    result.blankOrderDetails='PASS; destination, remarks and quantity checkbox edit and reset'
    await schedule.screenshot({path:`${out}/${phase}-admin-schedule.png`})
    result.blankSchedule='PASS; dates, currency, Incoterm and free text edit/reset; new order hides status/invoice date'
    result.blankReferences='PASS; original blanks, unsaved manual fields/revision and reload reset; no allocation clicks'
    await go('/shipping');await page.getByRole('heading',{name:'Production',exact:true}).waitFor()
    if(savedWooPath)await go(savedWooPath)
    else{
     const row=page.locator('tbody tr').filter({has:page.locator('button[title^="Duplicate this order"]')}).first()
     await row.waitFor();await row.click({position:{x:10,y:10}});await page.waitForURL(u=>/^\/shipments\/(?!new$)[^/]+$/.test(u.pathname))
    }
    await page.getByRole('button',{name:'Save Changes',exact:true}).waitFor()
    const badge=page.getByText(/^Stock: (not recorded|partly recorded|recorded)$/,{exact:true})
    await badge.waitFor()
    const label=await badge.textContent(),title=await badge.getAttribute('title')
    assert.ok(title)
    result.existingOrderPath=new URL(page.url()).pathname
    result.stockLabel=label;result.stockTooltip=title
    const savedRefs=await refs.locator('input').evaluateAll(inputs=>inputs.map(i=>i.value))
    const savedSchedule=await scheduleFields()
    const savedOrderDetails=await orderDetails()
    assert.equal(await schedule.getByText('Status',{exact:true}).count(),1)
    assert.equal(await schedule.getByText('Invoice Date',{exact:true}).count(),savedRefs[2]?1:0)
    await page.reload();await badge.waitFor();assert.equal(await badge.textContent(),label);assert.equal(await badge.getAttribute('title'),title)
    assert.deepEqual(await refs.locator('input').evaluateAll(inputs=>inputs.map(i=>i.value)),savedRefs)
    assert.deepEqual(await scheduleFields(),savedSchedule)
    assert.deepEqual(await orderDetails(),savedOrderDetails)
    result.savedOrderDetails='PASS; read-only destination, remarks and quantity preference survive refresh'
    result.savedSchedule='PASS; read-only dates, terms, status and conditional invoice date survive refresh'
    await badge.screenshot({path:`${out}/${phase}-admin-stock.png`})
    result.savedOrderAndStockRefresh='PASS; view only'
    await go(result.existingOrderPath+'?invoice=1')
    await page.waitForFunction(()=>document.activeElement===document.querySelector('input[placeholder="e.g. SI260094"]'))
    assert.deepEqual(await refs.locator('input').evaluateAll(inputs=>inputs.map(i=>i.value)),savedRefs)
    result.invoiceFocus='PASS; parent invoice query focuses the same saved-order input without edits/allocation'
   }else{
    await page.waitForURL(u=>u.pathname==='/shop');await page.getByText(/QA ONLY/).first().waitFor()
    assert.equal(await page.getByRole('heading',{name:'New Order',exact:true}).count(),0)
    assert.equal(await page.getByRole('heading',{name:'Schedule & Terms',exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:'Create Order',exact:true}).count(),0)
    await page.reload();await page.getByText(/QA ONLY/).first().waitFor()
    result.shippingRouteRefused='PASS'
   }
   assert.deepEqual(errors,[]);result.runtime=errors;result.completedAt=new Date().toISOString();report.roles.push(result)
   console.log(role+': fresh shipping route/data/stock/refresh/separation checks PASS')
  }finally{await context.close()}
 }
 await writeFile(`${out}/${phase}-shipping-${base.hostname}.json`,JSON.stringify(report,null,2)+'\n')
}finally{await browser.close()}
