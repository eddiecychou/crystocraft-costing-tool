// Run with firebase emulators:exec --only auth,firestore --project demo-portal-google.
// Real portal pages, Google popup emulator, Firebase-issued emulator tokens and invitation handler.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {initializeApp} from 'firebase-admin/app'
import {getFirestore} from 'firebase-admin/firestore'
import {getAuth} from 'firebase-admin/auth'
import handler from '../netlify/functions/portal-invite.js'
import {localPortalEmulators, createPortalEmulatorServer} from './portal-browser-emulators.mjs'

const projectId = 'demo-portal-google'
const emulators = localPortalEmulators(projectId)
const app = initializeApp({projectId})
const db = getFirestore(app)
const server = await createPortalEmulatorServer(emulators)
const {chromium} = createRequire(new URL('../.qa-playwright/package.json',import.meta.url))('playwright-core')
const browser = await chromium.launch({channel:'chrome',headless:true})
const originalFetch = globalThis.fetch
const sent = []
Object.assign(process.env, {RESEND_API_KEY:'fictional',MAIL_FROM:'OC <sender@example.invalid>',PORTAL_URL:'http://localhost'})
globalThis.fetch = (url, options) => {
  const endpoint = new URL(url)
  if (endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost') return originalFetch(url, options)
  assert.equal(endpoint.href,'https://api.resend.com/emails')
  sent.push(JSON.parse(options.body))
  return Response.json({id:'fictional-message-'+sent.length})
}

try {
  await server.listen()
  const origin = 'http://127.0.0.1:'+server.httpServer.address().port
  const createPage = async ({ interruptApplication = false } = {}) => {
    let submissions = 0
    const ctx = await browser.newContext()
    await ctx.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      // The emulator popup uses Google's public iframe library for postMessage.
      if (req.method() === 'GET' && req.resourceType() === 'script' && url.origin === 'https://apis.google.com') return route.continue()
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort()
      if (url.origin === origin && url.pathname === '/api/portal-invite') {
        const request = new Request(url, {method:req.method(), headers:req.headers(), body:req.postData()})
        if (interruptApplication && req.postDataJSON().action === 'apply_for_account') {
          submissions++
          if (submissions === 1) {
            const auth = getAuth(app), create = auth.createUser
            auth.createUser = async details => {
              await create.call(auth, details)
              throw Error('Fictional crash after creating the Auth user')
            }
            try { await assert.rejects(handler(request), /Fictional crash/) }
            finally { auth.createUser = create }
            return route.abort('connectionreset')
          }
          if (submissions === 2) {
            const response = await handler(request)
            assert.equal(response.status, 200, await response.text())
            return route.abort('connectionreset')
          }
        }
        const response = await handler(request)
        return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()})
      }
      if (url.origin === origin && url.pathname.startsWith('/api/')) return route.fulfill({json:{}})
      return route.continue()
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(20000)
    return page
  }
  async function google(page, button, email) {
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button',{name:button,exact:true}).click()])
    await popup.waitForURL(u=>u.host===emulators.authHost)
    await popup.locator('#add-account-button').click()
    await popup.locator('#email-input').fill(email)
    await popup.locator('#display-name-input').fill('Fictional Buyer')
    await popup.locator('#sign-in').click()
  }
  const readUser = async email => {
    const record = await getAuth(app).getUserByEmail(email)
    return db.doc('users/'+record.uid).get()
  }
  const googleEmail='fictional-google@example.test'
  const signup=await createPage()
  await signup.goto(origin+'/login')
  await google(signup,'Sign in with Google',googleEmail)
  await signup.getByRole('heading',{name:'One more thing'}).waitFor()
  await signup.locator('form input[type=text]').first().fill('Fictional Google Co')
  await signup.getByRole('button',{name:'Request account'}).click()
  await signup.getByRole('heading',{name:'Awaiting approval'}).waitFor()
  assert.equal((await readUser(googleEmail)).get('auth_provider'),'google.com')
  assert.equal((await readUser(googleEmail)).get('status'),'pending')
  console.log('PASS: Google popup and company form created a pending Google application')

  const invitedEmail='fictional-invited@example.test'
  await db.doc('customers/demo-company').set({company_name:'Fictional Invite Co'})
  const invite=db.doc('portal_invitations/demo-invite')
  await invite.set({source:'admin',status:'pending',customer_id:'demo-company',
    contact_email:invitedEmail,token_hash:createHash('sha256').update('fixture-only').digest('hex'),audit_log:[]})
  const claim=await createPage()
  await claim.goto(origin+'/invite/demo-invite?t=fixture-only')
  await google(claim,'Continue with Google','different@example.test')
  await claim.getByText(/doesn.t match this invitation/).waitFor()
  assert.equal((await invite.get()).get('status'),'pending')
  await google(claim,'Continue with Google',invitedEmail)
  await claim.getByRole('heading',{name:"You're in",exact:true}).waitFor()
  const approved=await readUser(invitedEmail)
  assert.equal(approved.get('status'),'approved')
  assert.equal(approved.get('customer_id'),'demo-company')
  assert.equal((await invite.get()).get('claimed_uid'), approved.id)
  console.log('PASS: mismatched Google email left the invitation pending; the invited buyer then claimed it and saw confirmation')

  const passwordEmail='fictional-password@example.test'
  const password=await createPage({ interruptApplication: true })
  const beforeSignup = sent.length
  for (const attempt of [1, 2, 3]) {
    await password.goto(origin+'/login')
    await password.getByRole('button',{name:'Create account',exact:true}).click()
    await password.locator('input[autocomplete=organization]').fill('Fictional Password Co')
    await password.locator('input[autocomplete=name]').fill('Fictional Contact')
    await password.locator('form input[type=email]').fill(passwordEmail)
    await password.getByRole('button',{name:'Request account'}).click()
    if (attempt < 3) {
      await password.getByText(/Could not submit your request/).waitFor()
      const profile = await readUser(passwordEmail)
      assert.equal(profile.exists, attempt === 2)
      assert.equal(sent.length, beforeSignup + (attempt === 2 ? 1 : 0))
    }
  }
  await password.getByRole('heading',{name:'Your new account request is under review'}).waitFor()
  const pending=await readUser(passwordEmail)
  assert.equal(pending.get('status'),'pending')
  assert.equal(pending.get('auth_provider'), undefined)
  assert.equal(sent.length, beforeSignup + 1)
  assert.equal((await db.collection('portal_invitations').where('contact_email','==',passwordEmail).get()).size, 1)
  assert.equal((await db.collection('users').where('email','==',passwordEmail).get()).size, 1)
  console.log('PASS: Chrome recovered from an interrupted Auth creation and a lost application response; one pending account and one captured alert')

  const passwordInviteEmail='fictional-password-invite@example.test'
  await db.doc('portal_invitations/password-invite').set({source:'admin',status:'pending',customer_id:'demo-company',
    contact_email:passwordInviteEmail,token_hash:createHash('sha256').update('fixture-password').digest('hex'),audit_log:[]})
  await password.goto(origin+'/invite/password-invite?t=fixture-password')
  await password.getByRole('button',{name:'Confirm and continue'}).click()
  await password.getByRole('heading',{name:"You're in",exact:true}).waitFor()
  const setup = sent.find(mail=>mail.to.includes(passwordInviteEmail) && mail.text.includes('/portal/set-password?'))
  assert.ok(setup)
  const setupUrl = new URL(setup.text.trim().split(/\s+/).at(-1))
  await password.goto(origin+setupUrl.pathname+setupUrl.search)
  await password.getByRole('heading',{name:'Set your password',exact:true}).waitFor()
  await password.locator('input[type=password]').nth(0).fill('Fictional-Approved-Only1')
  await password.locator('input[type=password]').nth(1).fill('Fictional-Approved-Only1')
  await password.locator('button[type=submit]').click()
  await password.waitForURL(u=>u.pathname==='/shop')
  assert.equal((await readUser(passwordInviteEmail)).get('status'),'approved')
  console.log('PASS: standard invitation, password setup and sign-in reached the approved storefront')
  // Both staff pages load the same pending account before either approves it.
  await pending.ref.update({customer_id:'demo-company'})
  const review=async suffix=>{
    const email='fictional-reviewer-'+suffix+'@example.test', secret='Fictional-Reviewer-Only1'
    const user=await getAuth(app).createUser({email,password:secret})
    await db.doc('users/'+user.uid).set({role:'admin',status:'approved',email})
    const page=await createPage()
    await page.goto(origin+'/login')
    await page.locator('input[type=email]').fill(email)
    await page.locator('input[type=password]').fill(secret)
    await page.locator('form button[type=submit]').click()
    await page.waitForURL(u=>u.pathname==='/dashboard')
    await page.goto(origin+'/portal/accounts/'+pending.id)
    await page.getByRole('button',{name:'Approve & send setup email'}).waitFor()
    return page
  }
  const first=await review('first'), second=await review('second')
  const markup=page=>page.getByLabel('Corp Gift Catalogue — Markup ×')
  await markup(first).fill('2.25')
  await markup(second).fill('3.75')
  const sentBefore=sent.length
  await first.getByRole('button',{name:'Approve & send setup email'}).click()
  await first.waitForURL(u=>u.pathname==='/portal')
  await second.getByRole('button',{name:'Approve & send setup email'}).click()
  await second.getByText(/request has changed/i).waitFor()
  assert.equal(await markup(second).inputValue(),'3.75')
  await second.getByRole('button',{name:'Save changes'}).click()
  await second.getByText(/request has changed/i).waitFor()
  const saved=await pending.ref.get()
  assert.equal(saved.get('status'),'approved')
  assert.equal((await db.doc('account_pricing/'+pending.id).get()).get('corp_markup_override'),2.25)
  assert.equal((await db.doc('portal_invitations/'+saved.get('invitation_id')).get()).get('status'),'approved')
  assert.equal(sent.length,sentBefore+1)
  console.log('PASS: two staff pages approved the same fictional buyer; winning price saved and losing draft preserved')

} finally {
  globalThis.fetch = originalFetch
  await browser.close()
  await server.close()
}
