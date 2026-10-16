import test from 'node:test'
import assert from 'node:assert/strict'
import { isQuickRangeEntry, quickRangePayload } from '../src/rangeQuickEntry.js'
test('quick entry opts in only for a new product; existing editors retain behavior',()=>{
 assert.equal(isQuickRangeEntry(true,new URLSearchParams('quick=1')),true)
 assert.equal(isQuickRangeEntry(false,new URLSearchParams('quick=1')),false)
 assert.equal(isQuickRangeEntry(true,new URLSearchParams()),false)
})
test('quick save cannot publish or price a product; preserves finish chips, parts and media without mutating input',()=>{
 const input={active:true,status:'active',description:'Confirmed facts',gallery:[{url:'approved-media'}],critical_components:[{id:'part',code:'EXACT-G',qty_per_unit:1}],unknown:'keep',variants:[{id:'v1',plating_code:'G',crystal_colors:['C1','BL'],ws_price_usd:12,colour_images:{C1:'keep'}}]}
 const saved=quickRangePayload(input,true)
 assert.equal(saved.active,false);assert.equal(saved.status,'concept');assert.equal(saved.variants[0].ws_price_usd,null)
 assert.deepEqual(saved.variants[0].crystal_colors,['C1','BL']);assert.deepEqual(saved.variants[0].colour_images,{C1:'keep'});assert.equal(saved.critical_components,input.critical_components);assert.equal(saved.gallery,input.gallery);assert.equal(saved.unknown,'keep')
 assert.equal(input.active,true);assert.equal(input.variants[0].ws_price_usd,12)
 for(const field of ['stock_qty','moq','lead_time_weeks','unit_cost'])assert.equal(saved[field],undefined)
 assert.equal(quickRangePayload(input,false),input)
})
