import {test} from 'node:test'
import assert from 'node:assert/strict'
import {inventoryIndex,matchPoLines,groupReceiptLines,poCodeChange,poStockIdentity,receiptId} from '../src/poReceiptModel.js'
const red={id:'red',code:'P-RE',name:'Red petal'},pink={id:'pink',code:'P-PI',name:'Pink petal'}
const link=c=>({type:'range',component_id:c.id,label:c.code})
const index=inventoryIndex({metal:[red,pink],crystal:[],packaging:[]})
test('changing colour replaces the old link and auto-filled description',()=>{
 const next=poCodeChange({code:red.code,description:red.name,linked:link(red)},pink.code,[red,pink])
 assert.deepEqual(next,{code:pink.code,description:pink.name,linked:link(pink)})
})
test('code edits clear stale links while preserving custom description text',()=>{
 assert.deepEqual(poCodeChange({code:red.code,description:'Custom supplier specification',linked:link(red)},'UNKNOWN',[red,pink]),{code:'UNKNOWN',linked:null})
 assert.deepEqual(poCodeChange({code:red.code,description:red.name,linked:link(red)},'P-',[red,pink]),{code:'P-',linked:null,description:''})
 assert.deepEqual(poCodeChange({code:red.code,linked:link(red)},' p-re ',[red,pink]),{code:' p-re '})
})
test('ambiguous codes never auto-link to the last library row',()=>{
 const rows=[pink,{...pink,id:'other'}]
 assert.equal(poCodeChange({code:'',description:''},pink.code,rows).linked,null)
})
test('receipt blocks mismatched or deleted links even when a correct code exists',()=>{
 for(const linked of [link(red),link({...red,id:'gone'})]) {
  const r=matchPoLines({lines:[{code:pink.code,qty:60,linked}]},index)
  assert.equal(r.items.length,0);assert.equal(r.conflicts.length,1)
 }
})
test('unambiguous item codes and explicit range links identify the proper stock item',()=>{
 const r=matchPoLines({lines:[{code:' p-re ',qty:102},{code:pink.code,qty:60,linked:link(pink)},{code:'charge',qty:0}]},index)
 assert.deepEqual(r.items.map(l=>[l.sku_id,l.qty,l.line_index]),[['red',102,0],['pink',60,1]])
 assert.equal(r.conflicts.length,0)
})
test('corporate component IDs cannot accidentally select a range component',()=>{
 const r=matchPoLines({lines:[{code:pink.code,qty:3,linked:{type:'corp',component_id:'red'}}]},index)
 assert.equal(r.items[0].sku_id,'pink')
})
test('duplicates across inventory classes require an explicit unambiguous link',()=>{
 const ix=inventoryIndex({metal:[red],crystal:[{...red,id:'same'}],packaging:[]})
 assert.equal(matchPoLines({lines:[{code:red.code,qty:1}]},ix).conflicts.length,1)
 assert.equal(matchPoLines({lines:[{code:red.code,qty:1,linked:link(red)}]},ix).items[0].cls,'metal')
})
test('duplicate SKU quantities are combined while each source row remains traceable',()=>{
 const rows=[{cls:'metal',sku_id:'red',code:red.code,qty:10,line_index:0},{cls:'metal',sku_id:'red',code:red.code,qty:20,line_index:1}]
 const [g]=groupReceiptLines(rows)
 assert.equal(g.qty,30);assert.equal(g.source_lines.length,2)
 assert.deepEqual(groupReceiptLines([...rows].reverse()),[g])
 assert.notEqual(receiptId('p',0,g),receiptId('p',0,{...g,cls:'crystal'}))
})
test('invalid, infinite and duplicated source quantities cannot be posted',()=>{
 const l={cls:'metal',sku_id:'red',code:red.code,qty:1,line_index:0}
 for(const qty of [0,-1,NaN,Infinity,'bad'])assert.throws(()=>groupReceiptLines([{...l,qty}]),/Invalid/)
 assert.throws(()=>groupReceiptLines([l,l]),/duplicated/)
 assert.throws(()=>groupReceiptLines([{...l,line_index:undefined}]),/missing/)
})
test('received stock identity excludes commercial text and price edits',()=>{
 const line={code:red.code,qty:10,linked:link(red),description:'old',unit_price:3}
 assert.deepEqual(poStockIdentity([line]),poStockIdentity([{...line,description:'new',unit_price:4}]))
 assert.notDeepEqual(poStockIdentity([line]),poStockIdentity([{...line,qty:20}]))
})
