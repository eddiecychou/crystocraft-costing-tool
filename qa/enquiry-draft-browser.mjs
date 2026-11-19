// Run inside Firebase emulators:exec --only auth,firestore --project demo-enquiry-drafts.
// Two real sign-ins per fictional buyer, one Chrome tab and one browser storage area.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdir} from 'node:fs/promises'
import {initializeApp} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {createServer} from 'vite'

const projectId = 'demo-enquiry-drafts'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const storeHost = process.env.FIRESTORE_EMULATOR_HOST
for (const host of [authHost, storeHost]) assert.match(host || '', /^127\.0\.0\.1:\d+$/)
assert.equal(process.env.GCLOUD_PROJECT, projectId)
const admin = initializeApp({projectId})
const password = 'fictional-enquiry-qa-only'
const buyers = [
  {id: 'buyer-a', name: 'Fictional Maple', qty: 7, note: 'Maple sample in green'},
  {id: 'buyer-b', name: 'Fictional Cedar', qty: 14, note: 'Cedar sample in blue'},
]
for (const buyer of buyers) {
  const email = buyer.id+'@example.test'
  await getAuth(admin).createUser({uid: buyer.id, email, password})
  await getFirestore(admin).doc('users/'+buyer.id).set({email, company_name: 'Fictional shared company',
    customer_id: 'same-company', role:'customer', status:'approved', base_currency:'USD'})
}

// Use the real login, storefront and enquiry pages. Only the catalogue HTTP
// response is seeded. Auth and Firestore use the local emulators throughout.
const server = await createServer({
  configFile: false, envDir: false, publicDir: false, logLevel: 'error',
  resolve: {alias: {'@': fileURLToPath(new URL('../src', import.meta.url))}},
  esbuild: {jsx: 'automatic'},
  define: Object.fromEntries(Object.entries({
    VITE_FIREBASE_API_KEY: 'fictional-key', VITE_FIREBASE_AUTH_DOMAIN: projectId+'.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_STORAGE_BUCKET: projectId+'.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456', VITE_FIREBASE_APP_ID: '1:123456:web:abc',
  }).map(([k,v])=>['import.meta.env.'+k,JSON.stringify(v)])),
  server: {host: '127.0.0.1', port: 0},
  plugins: [{name:'enquiry-emulators',
    transformIndexHtml: {order:'pre', handler: html=>html.replace('/src/main.jsx','/@id/enquiry-emulator-entry')},
    resolveId(id) { if (id === 'enquiry-emulator-entry') return '\0enquiry-emulator-entry' },
    load(id) {
      if (id !== '\0enquiry-emulator-entry') return
      return `
        import {auth,db} from '/src/firebase.js'
        import {connectAuthEmulator} from 'firebase/auth'
        import {connectFirestoreEmulator} from 'firebase/firestore'
        connectAuthEmulator(auth, 'http://${authHost}', {disableWarnings:true})
        connectFirestoreEmulator(db,'127.0.0.1',${Number(storeHost.split(':')[1])})
        await import('/src/main.jsx')
      `
    },
  }],
})
const {chromium} = createRequire(new URL('../.qa-playwright/package.json',import.meta.url))('playwright-core')
const browser = await chromium.launch({channel:'chrome',headless:true})
try {
  await server.listen()
  const origin = 'http://127.0.0.1:'+server.httpServer.address().port
  const page = await browser.newPage({viewport:{width:1280,height:900}})
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', e=>{ errors.push(e.message); console.error(e.message) })
  await page.route('**/*', route=>{
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') return route.abort()
    if (url.pathname === '/api/customer-catalogue') return route.fulfill({json:{
      products:buyers.map(b=>({id:b.id,name:b.name})).filter(p=>!url.searchParams.has('id') || url.searchParams.get('id')===p.id),
      featured:{items:[]},
    }})
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}})
    return route.continue()
  })
  await page.goto(origin+'/login')
  await page.evaluate(()=>localStorage.setItem('cc_cart',JSON.stringify([{id:'old',type:'corporate',name:'Ownerless sample',note:'Ownerless note'}])))
  async function signIn(buyer) {
    await page.locator('input[type=email]').fill(buyer.id+'@example.test')
    await page.locator('input[type=password]').fill(password)
    await page.locator('form button[type=submit]').click()
    await page.waitForURL(u=>u.pathname==='/shop')
    await page.goto(origin+'/shop/enquiry')
  }
  async function signOut() {
    await page.getByRole('button',{name:'Sign out',exact:true}).first().click()
    await page.waitForURL(u=>u.pathname==='/login')
  }
  const note = page.getByPlaceholder(/^Note \(/)
  for (const buyer of buyers) {
    await signIn(buyer)
    await page.getByText('Your enquiry list is empty', {exact:false}).waitFor()
    await page.goto(origin+'/shop/corporate/'+buyer.id)
    await page.getByRole('button',{name:'Add to enquiry'}).click()
    await page.locator('a[href="/shop/enquiry"]:visible').first().click()
    await note.fill(buyer.note)
    await page.getByRole('spinbutton').fill(String(buyer.qty))
    await signOut()
  }
  for (const buyer of buyers) {
    await signIn(buyer)
    for (const reload of [false,true]) {
      if (reload) await page.reload()
      await page.getByText(buyer.name,{exact:true}).waitFor()
      assert.equal(await note.count(),1)
      assert.equal(await note.inputValue(),buyer.note)
      assert.equal(await page.getByRole('spinbutton').inputValue(),String(buyer.qty))
      assert.equal(await page.getByText(buyers.find(b=>b!==buyer).name,{exact:true}).count(),0)
      assert.equal(await page.getByText('Ownerless sample',{exact:true}).count(),0)
    }
    await mkdir('qa/out/enquiry-draft-privacy',{recursive:true})
    await page.screenshot({path:'qa/out/enquiry-draft-privacy/'+buyer.id+'.png'})
    await signOut()
  }
  assert.deepEqual(errors,[])
  assert.equal((await getFirestore(admin).collection('enquiries').get()).size,0)
  console.log('PASS: two fictional buyers, four email/password sign-ins, distinct items, quantities and notes after sign-out and refresh. No enquiry submitted.')
} finally {
  await browser.close()
  await server.close()
}
