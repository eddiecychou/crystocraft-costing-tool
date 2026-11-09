// Actual OC layout, Portal and Accounts. Only Firebase reads and unrelated tabs are fixtures.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

let scratch, dom, App, root, host, mountRoot
const require = createRequire(import.meta.url)
const fixture = { subscribers: new Set(), accounts: [], followups: {}, calls: [] }
function snapshot(col) {
  let rows = col.path === 'users' ? fixture.accounts : []
  if (col.filter)
    rows = rows.filter((x) => x[col.filter.key] === col.filter.value)
  return {
    size: rows.length,
    docs: rows.map((x) => ({ id: x.id, data: () => x }))
  }
}
function subscribe(col, cb) {
  const update = () => cb(snapshot(col))
  update()
  const entry = { col, update }
  fixture.subscribers.add(entry)
  return () => fixture.subscribers.delete(entry)
}
async function setAccounts(rows) {
  fixture.accounts = rows
  await act(async () => {
    for (const s of fixture.subscribers) s.update()
  })
}
const click = async (label) => {
  const b = [...host.querySelectorAll('button')].find(
    (el) => el.textContent.trim() === label
  )
  assert.ok(b, label)
  await act(async () => b.click())
}
const mount = async (role) =>
  act(async () => root.render(React.createElement(App, { role })))
before(async () => {
  dom = new JSDOM('<html><body></body></html>', {
    url: 'https://fictional.invalid/portal'
  })
  for (const k of [
    'window',
    'document',
    'HTMLElement',
    'Event',
    'MouseEvent',
    'localStorage'
  ])
    globalThis[k] = dom.window[k]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.__ocPortalSubscribe = subscribe
  globalThis.__ocPortalFollowups = fixture
  mountRoot = (await import('react-dom/client')).createRoot
  scratch = await mkdtemp(join(tmpdir(), 'oc-portal-access-'))
  const stubs = {
    firestore:
      'export const collection=(_db,path)=>({path}),query=(c,filter)=>({...c,filter}),where=(key,_op,value)=>({key,value}),onSnapshot=(...a)=>globalThis.__ocPortalSubscribe(...a);',
    firebase: 'export const db={},auth={};',
    portalInviteApi: 'export const listAccountFollowupStates=async uids=>{const f=globalThis.__ocPortalFollowups;f.calls.push(uids);if(f.respond)return f.respond(uids);if(f.failure)throw Error("Fictional status unavailable");return {states:uids.map(uid=>({uid,waiting:f.followups[uid]?.state==="waiting"&&!f.followups[uid]?.active_message_id}))}};',
    auth: 'export const signOut=async()=>{};',
    i18n: 'export const useT=()=>s=>s;',
    appInfo:
      'export const APP_NAME="OC", APP_VERSION="Test", versionLabel=()=>"Fictional";',
    PortalLogins: 'export default ()=>null',
    Enquiries: 'export default ()=>null',
    PortalInvitations: 'export default ()=>null'
  }
  const entry = `import React from 'react';import {MemoryRouter} from 'react-router-dom';import Layout from './src/components/Layout.jsx';import Portal from './src/pages/Portal.jsx';import {AccessContext} from './src/access.js';
 export default function TestPortal({role}){return <MemoryRouter initialEntries={['/portal']} future={{v7_relativeSplatPath:true,v7_startTransition:true}}><AccessContext.Provider value={{role,modules:['portal']}}><Layout user={{email:'fictional@example.invalid'}}><Portal/></Layout></AccessContext.Provider></MemoryRouter>}`
  await build({
    stdin: { contents: entry, resolveDir: resolve('.'), loader: 'jsx' },
    outfile: join(scratch, 'page.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    loader: { '.png': 'dataurl' },
    plugins: [
      {
        name: 'fixture',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/
            },
            (a) => ({ path: require.resolve(a.path), external: true })
          )
          b.onResolve({ filter: /^firebase\/(auth|firestore)$/ }, (a) => ({
            path: basename(a.path),
            namespace: 'fixture'
          }))
          b.onResolve({ filter: /^\.\.?\// }, (a) => {
            const name = basename(a.path).replace(/\.jsx?$/, '')
            if (name in stubs) return { path: name, namespace: 'fixture' }
          })
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
            contents: stubs[a.path],
            loader: 'js'
          }))
        }
      }
    ]
  })
  App = (await import(pathToFileURL(join(scratch, 'page.mjs')))).default
})
beforeEach(() => {
  fixture.accounts = [];fixture.followups={};fixture.calls=[];fixture.failure=false;fixture.respond=null
  host = document.createElement('div')
  document.body.append(host)
  root = mountRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  assert.equal(fixture.subscribers.size, 0)
})
after(async () => {
  dom.window.close()
  delete globalThis.__ocPortalSubscribe
  delete globalThis.__ocPortalFollowups
  if (scratch) await rm(scratch, { recursive: true, force: true })
})
test('existing and newly arrived applications appear in the admin Portal badge and actionable review queue', async () => {
  const applicant = {
    id: 'fixture1',
    role: 'customer',
    status: 'pending',
    company_name: 'Fictional & Co',
    email: 'f@example.invalid'
  }
  const approved = {
    id: 'older',
    role: 'customer',
    status: 'approved',
    company_name: 'Existing Customer'
  }
  const staff = { id: 'staff', role: 'staff', status: 'pending' }
  await setAccounts([applicant, approved, staff])
  await mount('admin')
  const nav = () => host.querySelector('aside a[href="/portal"]')
  assert.ok(nav().textContent.includes('1'))
  assert.ok(host.textContent.includes('1 portal access request needs review'))
  await click('Invitations')
  await click('Review requests')
  assert.equal(
    host
      .querySelector('a[href="/portal/accounts/fixture1"]')
      .textContent.includes('Fictional & Co'),
    true
  )
  assert.equal(host.querySelector('a[href="/portal/accounts/older"]'), null)
  const two = { ...applicant, id: 'fixture2', company_name: 'Second applicant' }
  await setAccounts([applicant, approved, two])
  assert.match(nav().textContent, /2/)
  assert.match(host.textContent, /2 portal access requests need review/)
  await setAccounts([
    { ...applicant, status: 'approved' },
    approved,
    { ...two, status: 'suspended' }
  ])
  assert.doesNotMatch(nav().textContent, /[12]/)
  assert.doesNotMatch(host.textContent, /requests? needs? review/)
})
test('staff Portal login activity never subscribes to the admin pending queue or displays its count', async () => {
  await setAccounts([{ id: 'fixture', role: 'customer', status: 'pending' }])
  await mount('staff')
  assert.equal(
    [...fixture.subscribers].some((x) => x.col.path === 'users'),
    false
  )
  assert.equal(host.querySelector('button[aria-label="Review requests"]'), null)
  assert.doesNotMatch(host.textContent, /request needs review|Review requests/)
})


test('waiting-for-reply customers leave both menu badges but remain Pending; information received restores action',async()=>{
  const applicant={id:'waiting',role:'customer',status:'pending',company_name:'Fictional waiting customer'}
  fixture.followups.waiting={state:'waiting'}
  await setAccounts([applicant]);await mount('admin')
  const nav=()=>host.querySelector('aside a[href="/portal"]')
  assert.equal(nav().querySelector('[data-portal-request-count]'),null)
  assert.doesNotMatch(nav().textContent,/1/)
  assert.doesNotMatch(host.textContent,/request needs review/)
  await click('Pending 1')
  assert.ok(host.querySelector('a[href="/portal/accounts/waiting"]'))
  fixture.followups.waiting={state:'received'}
  await setAccounts([applicant])
  assert.match(nav().textContent,/1/)
  assert.match(host.textContent,/1 portal access request needs review/)
  fixture.followups.waiting={state:'waiting',active_message_id:'unconfirmed-send'}
  await setAccounts([applicant])
  assert.match(nav().textContent,/1/)
})

test('only awaiting replies are excluded; drafts and unknown send outcomes still need review',async()=>{
  const rows=['waiting','draft','unknown','new'].map(id=>({id,role:'customer',status:'pending'}))
  fixture.followups={waiting:{state:'waiting'},draft:{state:'new',draft:{}},unknown:{state:'waiting',active_message_id:'unconfirmed'}}
  await setAccounts(rows);await mount('admin')
  assert.match(host.querySelector('aside a[href="/portal"]').textContent,/3/)
  assert.match(host.textContent,/3 portal access requests need review/)
  assert.deepEqual(fixture.calls,[rows.map(row=>row.id)])
})

test('private follow-up status failures show an unavailable notice and never masquerade as a complete review',async()=>{
  fixture.failure=true
  await setAccounts([{id:'fixture',role:'customer',status:'pending'}]);await mount('admin')
  assert.match(host.textContent,/Pending request count is unavailable/)
  assert.match(host.querySelector('aside a[href="/portal"]').textContent,/1/)
})


test('a late status response cannot restore a badge for an older pending snapshot',async()=>{
  const gates=[]
  fixture.respond=uids=>new Promise(resolve=>gates.push({uids,resolve}))
  const one={id:'one',role:'customer',status:'pending'}
  await setAccounts([one]);await mount('admin')
  await setAccounts([one,{...one,id:'two'}])
  assert.equal(gates.length,2)
  await act(async()=>gates[1].resolve({states:[{uid:'one',waiting:true},{uid:'two',waiting:true}]}))
  await act(async()=>gates[0].resolve({states:[]}))
  assert.doesNotMatch(host.querySelector('aside a[href="/portal"]').textContent,/[12]/)
  assert.doesNotMatch(host.textContent,/requests? needs? review/)
})

test('large pending queues use bounded read-only status requests and count every account once',async()=>{
  const rows=Array.from({length:201},(_,i)=>({id:'fixture-'+i,role:'customer',status:'pending'}))
  fixture.followups=Object.fromEntries(rows.slice(0,200).map(row=>[row.id,{state:'waiting'}]))
  await setAccounts(rows);await mount('admin')
  assert.deepEqual(fixture.calls.map(uids=>uids.length),[100,100,1])
  assert.match(host.textContent,/1 portal access request needs review/)
})
