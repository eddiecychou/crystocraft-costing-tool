import test from 'node:test'
import assert from 'node:assert/strict'
import {setupRequestApproved,handleB0016SetupRelease} from '../netlify/edge-functions/lib/b0016SetupRelease.js'
import {b0016ReleaseRules} from '../scripts/b0016-release-rules.mjs'
import {readFileSync} from 'node:fs'
const now=Date.now(),control={approved:true,service_principal:'mcp-figurine-range-service',expires_at:new Date(now+1800000).toISOString(),design_request_id:'design',bom_request_id:'bom',range_id:'range',bom_hash:'hash'}
const body={op:'create_mezuzah_colour_bom',input:{approved:true,dry_run:false,request_id:'bom',range_id:'range',expected_preview_hash:'hash'}}
test('exact setup control allows only the two reviewed requests',()=>{
 assert.equal(setupRequestApproved(control,body,now),true)
 for(const change of [{approved:false},{expires_at:'bad'},{expires_at:new Date(now-1).toISOString()},{service_principal:'other'}])assert.equal(setupRequestApproved({...control,...change},body,now),false)
 for(const input of [{request_id:'other'},{range_id:'other'},{expected_preview_hash:'other'},{approved:false},{dry_run:true}])assert.equal(setupRequestApproved(control,{...body,input:{...body.input,...input}},now),false)
 assert.equal(setupRequestApproved(control,{...body,op:'create_mezuzah_range_components'},now),false)
 assert.equal(setupRequestApproved(control,{op:'create_mezuzah_range_design',input:{approved:true,dry_run:false,request_id:'design'}},now),true)
})
test('missing control denies write before catalogue access',async()=>{
 const urls=[];const r=await handleB0016SetupRelease(new Request('https://test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{authorize:async()=>({ok:true,uid:control.service_principal,role:'staff'}),projectId:'test',fetchImpl:async url=>{urls.push(url);return new Response('{}',{status:404})}})
 assert.equal(r.status,403);assert.equal((await r.json()).error.code,'WRITES_DISABLED');assert.equal(urls.length,1);assert.ok(urls[0].endsWith('range_mcp_approvals/b0016_setup_release'))
})
test('legacy writer never looks up owner control or accesses catalogue',async()=>{
 const r=await handleB0016SetupRelease(new Request('https://test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,op:'create_mezuzah_range_components'})}),{authorize:async()=>({ok:true,uid:control.service_principal,role:'staff'}),projectId:'test',fetchImpl:async()=>{throw Error('unexpected access')}})
 assert.equal(r.status,403)
})
test('release rules remove old two-component grants; historical phase-one fixture stays disabled',()=>{
 const main=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8'),candidate=b0016ReleaseRules(main)
 assert.ok(readFileSync(new URL('./fixtures/b0016-read-only.rules',import.meta.url),'utf8').includes('function b0016WritesApproved() {\n      return false;'))
 assert.ok(candidate.includes('let p = setupReleasePlan();'))
 assert.ok(!candidate.includes('b0016WritesApproved() && b0016ComponentCreate(componentId)'))
 assert.ok(!candidate.includes('b0016WritesApproved() && b0016QuoteCreate(componentId, quoteId)'))
 assert.ok(!candidate.includes('b0016RangeLink(rangeId) || colourRangeLink(rangeId)'))
 assert.ok(candidate.includes('request.resource.data.diff(p.design)'))
})
