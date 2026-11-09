// Drafts are fictional and remain on this device. No Firebase or live I/O.
import {test,beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {orderEditRevision,orderEditBase,orderEditPatch,sameOrderEditBase} from '../src/orderEditModel.js'
import {storeOrderEditDraft,loadOrderEditDrafts,removeOrderEditDraft} from '../src/orderEditDrafts.js'
const dom=new JSDOM('',{url:'https://fictional.invalid'})
beforeEach(()=>{globalThis.localStorage=dom.window.localStorage;localStorage.clear()})
after(()=>{delete globalThis.localStorage;dom.window.close()})
const draft=id=>({id,header:{notes:'Unsaved 中文',deposit_paid:155},lines:[{id:'keep',qty_ordered:1000,unit_price:1.222}],base:orderEditBase({}),savedAt:'2026-11-09T00:00:00.000Z'})
test('legacy version zero is independent of PI and invoice revisions',()=>{
  assert.equal(orderEditRevision({pi_revision:7,invoice_reference_revision:12}),0)
  assert.deepEqual(orderEditPatch(orderEditBase({}),'attempt-1'),{edit_revision:1,last_edit_id:'attempt-1',edit_origin_ms:null})
  for(const edit_revision of [-1,1.5,'1',2147483647])assert.throws(()=>orderEditRevision({edit_revision}),/invalid edit version/)
  assert.throws(()=>orderEditPatch({revision:2147483647},'id'),/Reload/)
  assert.equal(orderEditPatch(orderEditBase({createdAt:{seconds:1794216000,nanoseconds:123456000}}),'microseconds').edit_origin_ms,1794216000123)
})
test('base identity detects changes in commercial attempt, creation and invoice ownership',()=>{
  const before=orderEditBase({createdAt:{seconds:1,nanoseconds:2}})
  for(const patch of [{edit_revision:1},{last_edit_id:'another-save'},{createdAt:{seconds:2,nanoseconds:2}},{invoice_allocation_id:'different-owner'},{invoice_reference_revision:1},{erp_si_no:'SI-NEW'}])
    assert.equal(sameOrderEditBase(before,orderEditBase({createdAt:{seconds:1,nanoseconds:2},...patch})),false)
})
test('two tabs retain independent drafts through reload with exact monetary and line values',()=>{
  assert.equal(storeOrderEditDraft('operator-a','order-a',draft('tab-a')),true)
  assert.equal(storeOrderEditDraft('operator-a','order-a',draft('tab-b')),true)
  const reloaded=loadOrderEditDrafts('operator-a','order-a')
  assert.equal(reloaded.length,2);assert.equal(reloaded[0].header.deposit_paid,155)
  assert.equal(reloaded[0].lines[0].unit_price,1.222);assert.equal(reloaded[0].lines[0].id,'keep')
  assert.deepEqual(loadOrderEditDrafts('operator-b','order-a'),[])
  assert.deepEqual(loadOrderEditDrafts('operator-a','order-b'),[])
  removeOrderEditDraft('operator-a','order-a','tab-a')
  assert.deepEqual(loadOrderEditDrafts('operator-a','order-a').map(d=>d.id),['tab-b'])
})
test('malformed local entries do not hide valid drafts or escape account boundaries',()=>{
  storeOrderEditDraft('operator-a','order-a',draft('valid'))
  localStorage.setItem('oc-order-edit:operator-a:order-a:broken','not json')
  localStorage.setItem('oc-order-edit:operator-a:order-a:invalid',JSON.stringify({...draft('invalid'),savedAt:null}))
  assert.deepEqual(loadOrderEditDrafts('operator-a','order-a').map(d=>d.id),['valid'])
})
test('blocked device storage reports preservation failure without turning a server acknowledgement into an error',()=>{
  globalThis.localStorage={setItem(){throw Error('Blocked')},removeItem(){throw Error('Blocked')}}
  assert.equal(storeOrderEditDraft('operator-a','order-a',draft('valid')),false)
  assert.equal(removeOrderEditDraft('operator-a','order-a','valid'),false)
  assert.deepEqual(loadOrderEditDrafts('operator-a','order-a'),[])
})
