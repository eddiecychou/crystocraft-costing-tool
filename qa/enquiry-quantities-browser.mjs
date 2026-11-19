// Run inside Firebase Auth and Firestore emulators. All requests stay on loopback.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {initializeApp} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {localPortalEmulators, createPortalEmulatorServer} from './portal-browser-emulators.mjs'
import catalogue from '../netlify/functions/customer-catalogue.js'
import availability from '../netlify/functions/customer-availability.js'
import submitEnquiry from '../netlify/functions/customer-enquiry.js'
import {saveCustomerEnquiry} from '../netlify/functions/lib/customerEnquiry.js'

const projectId = 'demo-enquiry-quantities'
const emulators = localPortalEmulators(projectId)
initializeApp({projectId})
const db = getFirestore(), part = db.doc('range_components/part')
const fixture = {status:'active', active:true, design_code:'QA001', design_name:'Fictional Swan',
  variants:[{sku:'QA-S', plating_name:'Silver', plating_code:'S', ws_price_usd:2}],
  packing:{pcs_per_carton:24}, critical_components:[{id:'part', qty_per_unit:1}]}
await db.doc('range_products/swan').set(fixture)
await db.doc('range_products/rose').set({...fixture, design_code:'QA002'})
const ids = ['fictional-maple','fictional-cedar'], password = 'fictional-qa-12345'
for (const uid of ids) {
  const email = uid+'@example.test'
  await getAuth().createUser({uid, email, password})
  await db.doc('users/'+uid).set({email, role:'customer', status:'approved', base_currency:'USD'})
}
const routes = {'/api/customer-availability':availability, '/api/customer-catalogue':catalogue, '/api/customer-enquiry':submitEnquiry}
const server = await createPortalEmulatorServer(emulators)
const {chromium} = createRequire(new URL('../.qa-playwright/package.json',import.meta.url))('playwright-core')
const browser = await chromium.launch({channel:'chrome', headless:true})
try {
  await server.listen()
  const origin = 'http://127.0.0.1:'+server.httpServer.address().port
  for (const [index,uid] of ids.entries()) {
    await part.set({code:'SILVER', stock_qty:12, reserved_qty:4})
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    let lastSubmission
    await page.route('**/*', async route => {
      const r = route.request(), url = new URL(r.url())
      if (url.hostname !== '127.0.0.1') return route.abort()
      const handler = routes[url.pathname]
      if (handler) {
        const req = new Request(r.url(), {method:r.method(), headers:r.headers(), ...(r.postData() ? {body:r.postData()} : {})})
        if (handler === submitEnquiry) lastSubmission = r.postDataJSON()
        const response = await handler(req)
        return route.fulfill({status:response.status, contentType:'application/json', body:await response.text()})
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}}) // no email
      return route.continue()
    })
    await page.goto(origin+'/login')
    await page.locator('input[type=email]').fill(uid+'@example.test')
    await page.locator('input[type=password]').fill(password)
    await page.locator('form button[type=submit]').click()
    await page.waitForURL(u => u.pathname === '/shop')
    await page.goto(origin+'/shop/figurine/swan')
    await page.getByRole('button',{name:/From stock/}).waitFor()
    const add = page.getByRole('button',{name:'Add to enquiry',exact:true})
    const pieces = index === 0 ? 5 : 3
    await page.getByRole('spinbutton').fill(String(pieces))
    await add.click()
    await page.getByRole('button',{name:/Make to order/}).click()
    await add.click()
    await page.goto(origin+'/shop/enquiry')
    await page.reload()
    const stock = page.getByRole('spinbutton',{name:/Qty \(pcs\)/})
    const cartons = page.getByRole('spinbutton',{name:'Cartons'})
    await page.getByText('From stock · 8 pcs available').waitFor()
    assert.equal(await stock.inputValue(),String(pieces))
    assert.equal(await cartons.inputValue(),'1')
    await stock.fill('99')
    assert.equal(await stock.inputValue(),'8')
    await stock.fill(String(pieces))
    await page.getByRole('button',{name:'More cartons'}).click()
    await page.getByText('2 ctn · 48 pcs').waitFor()
    await page.getByPlaceholder(/^Note \(/).first().fill('Keep this fictional draft')
    await part.update({stock_qty:6}) // 2 unreserved after the buyer last checked
    const send = page.getByRole('button',{name:'Send enquiry'})
    await send.click()
    await page.getByRole('alert').filter({hasText:'Only 2 pcs'}).waitFor()
    assert.equal((await db.collection('enquiries').where('uid','==',uid).get()).size,0)
    await page.getByText('From stock · 2 pcs available').waitFor()
    assert.equal(await stock.inputValue(),String(pieces))
    assert.equal(await page.getByPlaceholder(/^Note \(/).first().inputValue(),'Keep this fictional draft')
    await stock.fill('2')
    await send.click()
    await page.getByRole('heading',{name:'Enquiry sent'}).waitFor()
    const saved = await db.collection('enquiries').where('uid','==',uid).get()
    assert.equal(saved.size,1)
    assert.deepEqual(saved.docs[0].get('items').map(i=>[i.order_mode,i.qty,i.cartons]),[['stock',2,0],['mto',48,2]])
    assert.equal(saved.docs[0].get('estimated_total'),100)
    assert.equal((await saveCustomerEnquiry(db,uid,lastSubmission)).created,false)
    const stockItem = lastSubmission.enquiry.items[0]
    const sharedOrder = {...lastSubmission, enquiryId:'shared-'+uid, enquiry:{...lastSubmission.enquiry,items:[stockItem,{...stockItem,id:'rose'}]}}
    await assert.rejects(saveCustomerEnquiry(db,uid,sharedOrder),/together exceed/)
    assert.equal((await db.doc('enquiries/shared-'+uid).get()).exists,false)
    const shortCarton = {...lastSubmission.enquiry.items[1], qty:25}
    await assert.rejects(saveCustomerEnquiry(db,uid,{...sharedOrder,enquiry:{...sharedOrder.enquiry,items:[shortCarton]}}),/carton size or quantity/)
    const old = {...stockItem, type:'figurine', qty:5, pcs_per_carton:24, cartons:1, note:'Original draft'}
    delete old.order_mode
    await page.evaluate(({uid,old}) => localStorage.setItem('cc_cart:'+uid,JSON.stringify([old])), {uid,old})
    await page.goto(origin+'/shop/enquiry')
    await page.getByText('Saved quantity: 5 pcs').waitFor()
    assert.ok(await send.isDisabled())
    await page.getByRole('button',{name:'Use pieces from stock'}).click()
    assert.equal(await stock.inputValue(),'5')
    assert.equal(await page.getByPlaceholder(/^Note \(/).first().inputValue(),'Original draft')
    const mixed = {...lastSubmission.enquiry, items:[{type:'corporate',id:'gift',qty:9},{type:'crystal_fabric',id:'fabric',qty:1,application:'Fictional drawing'}]}
    assert.ok((await saveCustomerEnquiry(db,uid,{enquiryId:'mixed-'+uid,enquiry:mixed})).created)
    assert.equal((await db.doc('enquiries/mixed-'+uid).get()).get('items')[1].application,'Fictional drawing')
    assert.deepEqual(errors,[])
    await page.close()
  }
  console.log('PASS: two fictional buyers selected stock and cartons of one SKU, reloaded, hit piece limits, kept their drafts after a stock drop, and submitted exact quantities. Mixed-design shared stock and partial cartons rejected. Retries created no duplicates.')
} finally { await browser.close(); await server.close() }
