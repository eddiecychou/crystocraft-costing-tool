import {test} from 'node:test'
import assert from 'node:assert/strict'
import {customerMergeFields,customerMergeContactMap} from '../src/customerMergeFields.js'
import {createCustomerMergeHandler} from '../netlify/functions/lib/customerMerge.js'
const request=(data,authorization='Bearer qa')=>new Request('https://example.test/api/customer-merge',{method:'POST',headers:authorization?{authorization}:{},body:JSON.stringify(data)})
test('preserves both plain-text notes, all flags and linked history sources in either direction',()=>{
 for(const [a,b] of [[{notes:'First',company_name:'A'},{notes:'Second',company_name:'B'}],[{notes:'Second',company_name:'B'},{notes:'First',company_name:'A'}]]){
 const result=customerMergeFields({...a,contacts:[],tags:['a'],sensitive:false},{...b,contacts:[],tags:['b'],sensitive:true,linked_marketing_contact_ids:['old']});assert.match(result.notes,/First/);assert.match(result.notes,/Second/);assert.equal(result.sensitive,true);assert.deepEqual(result.tags,['a','b']);assert.deepEqual(result.linked_marketing_contact_ids,['old'])}
})
test('contact-ID clashes preserve both people and remap the source reference deterministically',()=>{
 const a={contacts:[{id:'person',name:'A'}]},b={contacts:[{id:'person',name:'B'}]};assert.equal(customerMergeFields(a,b).contacts.length,2);assert.equal(customerMergeFields(a,b).contacts[0].name,'A');assert.equal(customerMergeContactMap(a,b).person,'merged-person')
})
test('endpoint denies anonymous, invalid, customer and staff callers before any merge',async()=>{
 let calls=0
 for(const role of ['customer','staff',null]){const h=createCustomerMergeHandler({verifyToken:async()=>({uid:'qa'}),getProfile:async()=>({role}),merge:async()=>{calls++}});assert.equal((await h(request({sourceId:'a',targetId:'b'}))).status,403)}
 const h=createCustomerMergeHandler({verifyToken:async()=>{throw Error('invalid')},getProfile:async()=>{},merge:async()=>{calls++}});assert.equal((await h(request({},null))).status,401);assert.equal((await h(request({}))).status,401);assert.equal(calls,0)
})
test('endpoint returns continuation and completion for the exact admin-selected pair',async()=>{
 let args;for(const complete of [false,true]){const h=createCustomerMergeHandler({verifyToken:async()=>({uid:'admin'}),getProfile:async()=>({role:'admin'}),merge:async(...a)=>{args=a;return {complete}}});const response=await h(request({sourceId:'a',targetId:'b',ignored:'cannot write arbitrary fields'}));assert.equal(response.status,complete?200:202);assert.deepEqual(args,['a','b','admin']);assert.equal(response.headers.get('Cache-Control'),'private, no-store')}
})
test('endpoint handles invalid body and non-POST without changes',async()=>{
 let calls=0;const h=createCustomerMergeHandler({verifyToken:async()=>({uid:'admin'}),getProfile:async()=>({role:'admin'}),merge:async()=>{calls++}});assert.equal((await h(new Request('https://example.test',{method:'GET'}))).status,405);assert.equal((await h(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer qa'},body:'{'}))).status,400);assert.equal(calls,0)
})
