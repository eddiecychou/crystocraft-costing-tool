import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocFromServer, getDocsFromServer, setDoc, Timestamp, updateDoc, deleteDoc } from 'firebase/firestore'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ExcelJS from 'exceljs'
import { PGlite } from '@electric-sql/pglite'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createShippingClosure } from '../netlify/functions/lib/shippingClosure.js'
import { orderRequestHandler } from '../netlify/functions/shipping-order-request.js'
import { createInvoiceRecoveryHandler } from '../netlify/functions/lib/invoiceRecovery.js'
import { createInvoiceRecoverySql } from '../netlify/functions/lib/invoiceRecoverySql.js'
import { invoiceExpected } from '../src/invoiceRecoveryModel.js'
import { createInvoiceRecoveryRepository } from '../netlify/functions/lib/invoiceRecoveryRepository.js'
import { createInvoiceFollowupQueue } from '../netlify/functions/lib/invoiceFollowupQueue.js'
import { fictionalInvoiceRequest } from './invoice-recovery-postgres-fixture.mjs'

const projectId = 'demo-shipping-closure-review'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
const env = await initializeTestEnvironment({projectId, firestore:{host,port:Number(port),rules:await readFile('firestore.rules','utf8')}})
const sql = new PGlite()
const adminApp = initializeApp({projectId},projectId)
const adminServer = getFirestore(adminApp)
const queue = createInvoiceFollowupQueue(adminServer,FieldValue.serverTimestamp)
const repository = createInvoiceRecoveryRepository(adminServer, FieldValue.serverTimestamp)
const getProfile = async uid => (await adminServer.doc(`users/${uid}`).get()).data()
const verifyToken = async uid => ({ uid })
const closeHandler = orderRequestHandler({ verifyToken, getProfile, closure: createShippingClosure(adminServer) })
const invoiceSql = createInvoiceRecoverySql({ url:'https://fictional.invalid', key:'fixture', fetchImpl: async (url, options) => {
  const args = JSON.parse(options.body)
  assert.ok(String(url).endsWith('/rpc/review_invoice_allocation_followups'))
  return Response.json((await sql.query('select result from public.review_invoice_allocation_followups($1::uuid,$2,$3,$4)',
    [args.p_operation_id,args.p_order_id,args.p_by,args.p_reason])).rows)
} })
const invoiceHandler = createInvoiceRecoveryHandler({ verifyToken, getProfile, repo:repository, sql:invoiceSql })
const call = async (handler, who, body) => {
  const res = await handler(new Request('http://localhost/fixture', { method:'POST', headers:{ Authorization:`Bearer ${who}` }, body:JSON.stringify(body) }))
  return { status:res.status, body:await res.json() }
}
const status = async id => {
  const response = await call(closeHandler,'fictional-shipping-staff',{action:'closure_status',order_id:id})
  assert.equal(response.status,200,JSON.stringify(response.body))
  return response.body
}
const confirm = (id,review) => call(closeHandler,'fictional-shipping-staff',{
  action:'close_order',order_id:id,base:review.base,token:review.token,reason:'Fictional closure',
})
const window = new JSDOM('<div id="root"></div>', {url:'http://localhost/'}).window
Object.assign(globalThis,{window,document:window.document})
const admin = env.authenticatedContext('fictional-admin').firestore()
const ship = env.authenticatedContext('fictional-shipping-staff').firestore()
const customer = env.authenticatedContext('fictional-customer-login').firestore()
const row = async (db, path) => (await getDocFromServer(doc(db,path))).data()
const rows = async (db, path) => (await getDocsFromServer(collection(db,path))).docs.map(snap => ({id:snap.id, ...snap.data()}))
const set = (db, path, value) => setDoc(doc(db,path),value)
const seed = fn => env.withSecurityRulesDisabled(context => fn(context.firestore()))
const date = Timestamp.fromDate(new Date('2026-11-14T00:00:00Z'))
const output = { projectId }
const positivePackingTokens = ['PACKING LIST','Fictional consignee','FICTIONAL-PO','FICTIONAL-SO','FICTIONAL-UC','Fictional legacy tier','3 sets','4 boxes']
const rejectsPermission = {code:'permission-denied'}

await mkdir('qa/out', { recursive:true })
const scratch = await mkdtemp(resolve('qa/out/shipping-closure-'))

async function loadBundle() {
  await build({stdin:{resolveDir:process.cwd(),contents:`
    export * from './src/shipping.js'
    export * from './src/orderStock.js'
    export * from './src/logistics.js'
    export { crystalInventory } from './src/crystals.js'
    export { packagingInventory } from './src/packaging.js'
    export { default as Shipping } from './src/pages/Shipping.jsx'
    export { default as Packing } from './src/pages/PackingListPrint.jsx'
    export { default as Invoice } from './src/pages/SalesInvoicePrint.jsx'
    export { default as CustomerInvoice } from './src/customer/CustomerInvoicePrint.jsx'
  `}, outfile:`${scratch}/app.mjs`, bundle:true, platform:'node', format:'esm', jsx:'automatic', loader:{'.png':'dataurl'},
    external:['firebase/*','react','react-dom','react-router-dom','exceljs','lucide-react'], plugins:[{name:'emulator-only',setup(b) {
      b.onResolve({filter:/\/firebase(?:\.js)?$/},a=>a.path.startsWith('.')?{path:'db',namespace:'fixture'}:null)
      b.onResolve({filter:/\/erpApi$/},()=>({path:'erp',namespace:'erp-fixture'}))
      b.onLoad({filter:/.*/,namespace:'erp-fixture'},()=>({contents:`export const erpLines=async()=>[];export const erpLookup=async()=>[{code:'FICTIONAL-SO',customer:'Fictional ERP duplicate'}]`,loader:'js'}))
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const db=globalThis.__shippingDeletionDb;
        export const authedUser=async()=>{throw Error('External requests disabled for review')};
        export const authHeader=authedUser; export const storage=null;`,loader:'js'}))
    }}]})
  const roleBundle = async (db,role) => {
    globalThis.__shippingDeletionDb=db
    return import(pathToFileURL(`${scratch}/app.mjs`).href+'?'+role)
  }
  return [await roleBundle(admin,'admin'),await roleBundle(ship,'staff'),await roleBundle(customer,'customer')]
}

async function render(Component, path, entry, ready, props, inspect) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  root.render(createElement(MemoryRouter,{initialEntries:[entry]}, createElement(Routes,null,
    createElement(Route,{path,element:createElement(Component,props)}))))
  try {
    for (let attempt=0;attempt<120;attempt++) {
      const value = container.textContent
      if (ready(value)) return inspect ? await inspect(container) : value
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    throw Error(`Route ${entry} did not load: ${container.textContent}`)
  } finally { root.unmount();container.remove() }
}

const order = async (db,id,extra={}) => {
  await set(db,`orders/${id}`,{customer_id:'fictional-customer',customer_name:'Fictional consignee',currency:'USD',status:'confirmed',...extra})
  for (const [line,qty,unit] of [['legacy',3,'sets'],['snapshot',4,'boxes']]) {
    await set(db,`orders/${id}/lines/${line}`,{line_no:qty,item_code:`FICTIONAL-${line}`,description:`Fictional ${line}`,qty_ordered:qty,unit_price:12,unit,tier_remarks:line==='legacy'?'Fictional legacy tier':''})
  }
}

async function initialiseSql() {
  await sql.exec(`create role anon;create role authenticated;create role service_role;
    create schema raw;create table raw.salesinvoice(sino text);
    create sequence public.fictional_uc_number start 100;
    create table public.uc_registry(id bigserial primary key,uc_no text default ('UC'||nextval('public.fictional_uc_number')),year text,customer text,currency text,status text,created_by text,
      updated_at timestamptz,updated_by text,source text,customer_id text,order_no text,total numeric,deposit numeric,balance numeric,bal_pay_date text,remarks text,confirmed boolean);`)
  for (const path of ['erp-sync/app_sales_invoice.sql','erp-sync/migrations/20261108013402_invoice_retry_recovery.sql','erp-sync/migrations/20261112011943_guard_invoice_followup_review.sql']) await sql.exec(await readFile(path,'utf8'))
}

try {
  await env.clearFirestore()
  const [a,s,c] = await loadBundle()
  const id = 'fictional-closure-order'
  const adminOrder = adminServer.doc(`orders/${id}`)
  await seed(async db=>{
    await set(db,'users/fictional-admin',{role:'admin',status:'approved'})
    await set(db,'users/fictional-shipping-staff',{role:'staff',status:'approved',modules:['shipping']})
    await set(db,'users/fictional-customer-login',{role:'customer',status:'approved',customer_id:'fictional-customer'})
    await set(db,'customers/fictional-customer',{company_name:'Fictional consignee'})
    await order(db,id,{erp_so_no:'FICTIONAL-SO',customer_po:'FICTIONAL-PO',uc_no:'FICTIONAL-UC'})
    await order(db,'fictional-interrupted',{customer_name:'Fictional interrupted order'})
    await order(db,'fictional-repeat',{customer_name:'Fictional repeat order',erp_so_no:'FICTIONAL-REPEAT'})
    await set(db,'users/fictional-unrelated',{role:'customer',status:'approved',customer_id:'other-company'})
  })
  const balance = async (cfg,key) => {
    const path = `${cfg.collectionPath}/${key}`
    const stock = await row(admin,path)
    const movements = await rows(admin,path+'/movements')
    assert.ok(movements.every(m=>m.order_id === (key==='partial'?'fictional-interrupted':id)))
    return [stock.stock_qty,stock.reserved_qty,movements.length]
  }
  const metal = a.metalOrderConfig, crystal = a.crystalInventory, packaging = a.packagingInventory
  for (const [cfg,key] of [[metal,'metal'],[crystal,'crystal'],[packaging,'box'],[crystal,'partial']]) {
    await adminServer.doc(`${cfg.collectionPath}/${key}`).set({code:key,stock_qty:100,reserved_qty:0,ledger_seeded:true})
  }
  const selection = (cfg,key,qty) => ({[cfg.order.lineIdField]:key,code:key,qty})
  await a.reserveForOrder(metal,id,id,[selection(metal,'metal',10)])
  await a.reserveForOrder(crystal,id,id,[selection(crystal,'crystal',7)])
  await a.produceForOrder(crystal,id,id)
  assert.deepEqual(await balance(metal,'metal'),[100,10,1])
  assert.deepEqual(await balance(crystal,'crystal'),[93,0,2])
  assert.equal((await status(id)).stock[0].state,'reserved')
  await a.releaseForOrder(metal,id,id)
  assert.deepEqual(await balance(metal,'metal'),[100,0,2])
  await assert.rejects(a.reserveForOrder(crystal,'fictional-interrupted','fixture',[
    selection(crystal,'partial',4),selection(crystal,'missing',2),
  ]),/Item not found/)
  assert.deepEqual(await balance(crystal,'partial'),[100,4,1])
  const partial = await row(admin,'orders/fictional-interrupted')
  assert.equal(partial.stock_activity,true)
  assert.equal(partial.crystals_reserved,undefined)
  await assert.rejects(a.releaseForOrder(crystal,'fictional-interrupted','fixture'),/unfinished|stock action/)
  const partialReview=await status('fictional-interrupted')
  assert.equal(partialReview.stock[1].state,'review')
  assert.equal((await confirm('fictional-interrupted',partialReview)).status,409)
  assert.deepEqual(await balance(crystal,'partial'),[100,4,1])
  output.stock = {explicitRelease:[100,0,2],consumed:[93,0,2],interrupted:[100,4,1],interruptedHeaderReserved:partial.crystals_reserved??null}

  await initialiseSql()
  const allocations=[]
  for (const purpose of ['first','split','reissue']) {
    const operation = randomUUID()
    const { rows:[result] } = await sql.query('select * from public.allocate_sales_invoice_once($1::uuid,$2::jsonb)',[operation,fictionalInvoiceRequest({order_id:id,purpose,reason:purpose==='first'?'':`Fictional ${purpose}`})])
    allocations.push({operation,result,purpose})
  }
  assert.equal(new Set(allocations.map(({result})=>result.o_si_no)).size,3)
  const latest=allocations.at(-1), earlier=allocations[0]
  const counts = async () => (await sql.query(`select (select count(*)::int from app_sales_invoice) invoices,(select count(*)::int from uc_registry) registry,(select count(*)::int from app_sales_invoice_audit) audit,(select count(*)::int from oc_invoice_private.invoice_allocations) receipts`)).rows[0]
  const beforeCounts=await counts()
  await adminOrder.update({erp_si_no:latest.result.o_si_no,invoiced_at:'2026-11-14',invoice_allocation_id:latest.operation,invoice_reference_revision:1,edit_revision:1})
  const job = operation => adminServer.doc(`invoice_followup_jobs/${operation}_financial`)
  for (const [index,{operation,result,purpose}] of allocations.entries()) {
    await adminOrder.collection('invoice_allocations').doc(operation).set({order_id:id,id:operation,status:'linked',result:{si_no:result.o_si_no,uc_no:result.o_uc_no},request:{purpose},created_at:new Date(2026,10,14,0,index),followups:{financial:{state:index===1?'done':'pending'},woo:{state:'not_applicable'}}})
    await adminServer.doc(`uc_invoices/${result.o_uc_no.replace('/','-')}`).set({uc_no:result.o_uc_no,si_no:result.o_si_no,order_id:id})
    if(index!==1) await job(operation).set({order_id:id,operation_id:operation,stage:'financial',edit_revision:1,next_at:0,automatic_attempts:0})
  }
  await seed(async db=>{
    await set(db,'packing_lists/fictional-packing',{order_id:id,label:'Fictional packing',selected:true,consignee_name:'',packing_save_id:'fictional-save',totals:{cbm:0.12,chargeable_weight_kg:20,carton_count:1}})
    await set(db,'packing_lists/fictional-packing/cartons/carton',{carton_seq:1,carton_count:1,pallet_no:1,gw_kg:20})
    await set(db,'packing_lists/fictional-packing/cartons/carton/contents/legacy',{order_line_id:'legacy',item_code:'FICTIONAL-legacy',description:'Fictional legacy',qty:3})
    await set(db,'packing_lists/fictional-packing/cartons/carton/contents/snapshot',{order_line_id:'snapshot',item_code:'FICTIONAL-snapshot',description:'Fictional snapshot',qty:4,unit:'boxes',tier_remarks:'Fictional saved tier'})
    await set(db,'freight_quotes/fictional-freight',{order_id:id,vendor_id:'fictional-vendor',scenario_id:'fictional-packing',scenario_label:'Fictional packing',currency:'USD',quoted_total:145.25,cargo_basis:{cbm:0.12,chargeable_weight_kg:20,cartons:1},createdAt:date})
  })
  await s.setFreightChoice(id,'fictional-freight',true)
  const packing = () => render(s.Packing,'/packing/:plId/print','/packing/fictional-packing/print',v=>v.includes('PACKING LIST'))
  const packingExcel = () => render(s.Packing,'/packing/:plId/print','/packing/fictional-packing/print',v=>v.includes('PACKING LIST'),undefined,async container=>{
    let downloaded
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL, click = window.HTMLAnchorElement.prototype.click
    URL.createObjectURL = blob => { downloaded = blob; return 'blob:fictional' }
    URL.revokeObjectURL = () => {}
    window.HTMLAnchorElement.prototype.click = () => {}
    try {
      Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Download Excel').click()
      for (let attempt=0;!downloaded && attempt<100;attempt++) await new Promise(resolve=>setTimeout(resolve,20))
      assert.ok(downloaded)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await downloaded.arrayBuffer())
      const values = workbook.getWorksheet(1).getSheetValues()
      const cells = values.flat()
      for (const value of ['sets','boxes','FICTIONAL-PO','FICTIONAL-UC','Fictional legacy tier']) assert.ok(cells.includes(value),value)
      return values
    } finally {
      URL.createObjectURL = create; URL.revokeObjectURL = revoke; window.HTMLAnchorElement.prototype.click = click
    }
  })
  const invoice = () => render(a.Invoice,'/shipments/:id/invoice',`/shipments/${id}/invoice`,v=>v.includes(latest.result.o_si_no))
  const ownInvoice = () => render(c.CustomerInvoice,'/shop/invoice/:key',`/shop/invoice/app-${id}`,v=>v.includes(latest.result.o_si_no),{profile:{customer_id:'fictional-customer',company_name:'Fictional consignee'}})
  const beforePacking = await packing(), beforeInvoice = await invoice(), beforeCustomer = await ownInvoice(), beforeExcel = await packingExcel()
  for (const token of positivePackingTokens) assert.ok(beforePacking.includes(token),token)
  const beforeFreight = await s.loadOrderFreight(id)
  const beforeLines = await a.getOrderLines(id)
  const beforeMirrors = await rows(admin,'uc_invoices')
  const beforeStage = (await a.getOrder(id)).status
  const billing = await status('fictional-repeat')
  assert.ok(billing.blockers.some(message=>message.includes('billing disposition')))
  assert.equal((await confirm('fictional-repeat',billing)).status,409)
  const pending = await status(id)
  assert.equal(pending.invoices.filter(op=>op.state==='followups').length,2)
  assert.equal((await confirm(id,pending)).status,409)
  assert.equal((await call(closeHandler,'fictional-customer-login',{action:'closure_status',order_id:id})).status,403)
  assert.equal(await queue.claimFollowup(id,earlier.operation,'financial',true),null)
  assert.equal((await job(earlier.operation).get()).exists,false)
  assert.equal((await status(id)).invoices.find(op=>op.id===earlier.operation).state,'followups')
  const claim=await queue.claimFollowup(id,latest.operation,'financial',true)
  assert.ok(claim?.token)
  const reviewPayload = operation => ({action:'closure_review_followups',order_id:id,previous_operation_id:operation,reason:'Fictional finance review'})
  assert.equal((await call(invoiceHandler,'fictional-shipping-staff',reviewPayload(earlier.operation))).status,403)
  for (const op of [earlier,latest]) assert.equal((await call(invoiceHandler,'fictional-admin',reviewPayload(op.operation))).status,200)
  const {rows:[late]}=await sql.query("select result from public.apply_claimed_invoice_followup($1::uuid,'financial','{}'::jsonb,'{}'::jsonb,$2::timestamptz)",[latest.operation,claim.deadline])
  assert.equal(late.result.followup_review.reason,'Fictional finance review')
  await queue.settleFollowup(id,latest.operation,'financial',claim,{state:'done'},false)
  assert.equal((await repository.operation(id,latest.operation)).followups.financial.state,'manual_review')
  assert.equal((await job(latest.operation).get()).exists,false)
  const stale = await status(id)
  await updateDoc(doc(ship,'packing_lists/fictional-packing'),{label:'Fictional changed before close'})
  assert.equal((await confirm(id,stale)).body.code,'closure-changed')
  await updateDoc(doc(ship,'packing_lists/fictional-packing'),{label:'Fictional packing'})
  const ready=await status(id)
  assert.deepEqual(ready.blockers,[])
  assert.deepEqual(ready.stock.map(s=>s.state),['clear','consumed','clear'])
  const closed = await Promise.all([confirm(id,ready),confirm(id,ready)])
  assert.ok(closed.every(r=>r.status===200 && r.body.closed),JSON.stringify(closed))
  assert.equal((await adminOrder.collection('closure_audit').get()).size,1)
  assert.equal((await adminOrder.get()).get('shipping_closed'),true)
  assert.equal((await a.getOrder(id)).status,beforeStage)
  assert.deepEqual(await a.getOrderLines(id),beforeLines)
  assert.equal(await packing(),beforePacking)
  assert.deepEqual(await packingExcel(),beforeExcel)
  assert.equal(await invoice(),beforeInvoice)
  assert.equal(await ownInvoice(),beforeCustomer)
  assert.deepEqual(await s.loadOrderFreight(id),beforeFreight)
  assert.deepEqual(await rows(admin,'uc_invoices'),beforeMirrors)
  assert.deepEqual(await counts(),beforeCounts)
  assert.equal((await repository.state(id)).history.length,3)
  for (const path of [`orders/${id}/invoice_allocations/${latest.operation}`,`orders/${id}/closure_audit/closed`])
    await assert.rejects(()=>row(customer,path),rejectsPermission)
  await assert.rejects(()=>a.reserveForOrder(packaging,id,id,[selection(packaging,'box',2)]),/closed/)
  await assert.rejects(()=>s.setFreightChoice(id,'fictional-freight',false),rejectsPermission)
  await assert.rejects(()=>set(ship,'packing_lists/fictional-new-scenario',{order_id:id,label:'Fictional stale tab'}),rejectsPermission)
  await assert.rejects(()=>deleteDoc(doc(ship,'packing_lists/fictional-packing/cartons/carton/contents/legacy')),rejectsPermission)
  await assert.rejects(()=>updateDoc(doc(ship,`orders/${id}`),{shipping_closed:false}),rejectsPermission)
  await assert.rejects(async ()=>repository.begin(id,{action:'new',previous_operation_id:latest.operation,purpose:'reissue',reason:'Fictional stale tab',expected:invoiceExpected((await a.getOrder(id)))},{uid:'fictional-admin'}),/closed/)
  assert.equal(await queue.claimFollowup(id,latest.operation,'financial',true),null)
  const otherCustomer = env.authenticatedContext('fictional-unrelated').firestore()
  await assert.rejects(()=>row(otherCustomer,`orders/${id}`),rejectsPermission)
  await render(s.Shipping,'/shipping','/shipping',v=>v.includes('Fictional repeat order')&&!v.includes('loading JES history'),{uid:'fictional-shipping-staff'},async container=>{
    assert.ok(!container.textContent.includes('Fictional consignee'))
    assert.ok(!container.textContent.includes('Fictional ERP duplicate'))
    Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Closed').click()
    for (let attempt=0;!container.textContent.includes('Fictional consignee') && attempt<100;attempt++) await new Promise(resolve=>setTimeout(resolve,20))
    assert.ok(container.textContent.includes(latest.result.o_si_no))
    assert.ok(!container.textContent.includes('Fictional repeat order'))
  })
  output.closure={id,stock:ready.stock,invoices:ready.invoices.length,documents:ready.documents,
    actualPrintViewsAndExcelUnchanged:true,closedListAndJesDeduplication:true,roleSeparation:true,duplicateConfirmationOneAudit:true,
    staleLinkedWorkRejected:true,lateInvoiceWriteFenced:true,counts:beforeCounts}
  console.log(JSON.stringify(output,null,2))
} finally {
  await Promise.allSettled([sql.close(),env.cleanup(),adminServer.terminate(),deleteApp(adminApp)])
  window.close()
  await rm(scratch, { recursive:true, force:true })
}
