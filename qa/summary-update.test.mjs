import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createSummaryUpdateStore} from '../src/summaryUpdate.js'
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
test('unmount/remount retains busy progress and rejects a duplicate run across periods',async()=>{
 const wait=deferred();let calls=0,progress
 const store=createSummaryUpdateStore((days,onProgress)=>{calls++;assert.equal(days,30);progress=onProgress;return wait.promise})
 const snapshots=[];const unsub=store.subscribe(()=>snapshots.push(store.getSnapshot()))
 const first=store.start(30);assert.equal(store.getSnapshot().running,true);assert.equal(store.start(90),first);await Promise.resolve();assert.equal(calls,1)
 progress(3,8);unsub();progress(6,8)
 assert.match(store.getSnapshot().progress,/6 of 8/);assert.equal(store.getSnapshot().days,30)
 let remountChanges=0;const stop=store.subscribe(()=>remountChanges++);assert.equal(store.start(14),first)
 wait.resolve({items:[]});await first;assert.equal(calls,1);assert.equal(store.getSnapshot().running,false);assert.equal(store.getSnapshot().progress,'');assert.equal(remountChanges,1);assert.equal(snapshots.length,2);stop()
})
test('failure while away is retained, unlocks retry, and retry clears the error',async()=>{
 const wait=deferred();let calls=0
 const store=createSummaryUpdateStore(()=>++calls===1?wait.promise:Promise.resolve('saved'))
 const job=store.start(90);wait.reject(Error('AI service unavailable. Saved summaries are unchanged.'));await job
 assert.equal(store.getSnapshot().running,false);assert.match(store.getSnapshot().error,/unavailable/)
 const retry=store.start(90);assert.equal(store.getSnapshot().error,'');assert.equal(await retry,'saved');assert.equal(calls,2);assert.equal(store.getSnapshot().running,false)
})
test('fresh browser runtime has no stale updating flag, and snapshot identity is stable between updates',()=>{
 const store=createSummaryUpdateStore(()=>{});assert.equal(store.getSnapshot(),store.getSnapshot());assert.deepEqual(store.getSnapshot(),{running:false,days:null,progress:'',error:''});assert.throws(()=>store.start(7),/Choose/);assert.equal(store.getSnapshot().running,false)
})
test('a re-entrant subscriber cannot launch a second update before the first starts',async()=>{
 let calls=0;const wait=deferred();const store=createSummaryUpdateStore(()=>{calls++;return wait.promise});const stop=store.subscribe(()=>{if(store.getSnapshot().running)store.start(365)})
 const job=store.start(14);await Promise.resolve();assert.equal(calls,1);wait.resolve();await job;stop()
})
