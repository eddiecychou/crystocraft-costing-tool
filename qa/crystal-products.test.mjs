import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cleanCrystalProduct,cleanCrystalVariant,crystalEnquiryLine,crystalEnquirySnapshot,crystalStockAvailability,filterCrystalProducts,draftFromCrystalStock} from '../src/domain/crystalProducts.js'
import {createCrystalAvailabilityHandler} from '../netlify/functions/lib/crystalAvailability.js'
import {createSwatchImageHandler} from '../netlify/edge-functions/lib/swatchImage.js'
const base={code:'CC-EXAMPLE',name:'Example octagon',family:'cut',origin:'crystocraft',supply:'made_to_order',unit:'pcs',publication:'draft'}
const variant={id:'v_clear_example',code:'CC-EXAMPLE-CLEAR',label:'Clear octagon',size:'14 mm',holes:'2',unit:'pcs',confirmed:true,publication:'published',revision:3}
const p={...cleanCrystalProduct(base),id:'cp_example',publication:'published',hero_id:'im_example',primary_variant_id:variant.id,revision:5}
test('explicit product and variant allowlists drop private supplier/price fields',()=>{
 assert.equal(cleanCrystalProduct({...base,cost:99,supplier:'private'}).cost,undefined)
 assert.equal(cleanCrystalVariant({...variant,stock_qty:5}).stock_qty,undefined)
})
test('stock-only brand cannot be sold as replenishable or published without review',()=>{
 for(const d of [{...base,origin:'swarovski_strass'}, {...base,origin:'swarovski_strass',supply:'stock_only',publication:'published',hero_id:'photo',primary_variant_id:'v'}])assert.throws(()=>cleanCrystalProduct(d))
 assert.equal(cleanCrystalProduct({...base,origin:'swarovski_strass',supply:'stock_only',publication:'published',hero_id:'photo',primary_variant_id:'v',provenance_reviewed:true,condition:'Inspected, original packaging',article_reference:'example'}).publication,'published')
 assert.throws(()=>cleanCrystalVariant({...variant,confirmed:false}))
})
test('stock draft preserves source identity without guessing article or quantity',()=>{
 const d=draftFromCrystalStock({id:'inventory_example',code:'OLD-CODE',name:'Original description',stock_qty:12},'swarovski_strass')
 assert.equal(d.id,'cp_stock_inventory_example');assert.equal(d.publication,'draft');assert.equal(d.article_reference,'');assert.equal(d.provenance_reviewed,false);assert.equal(d.stock_qty,undefined);assert.equal(d.supply,'stock_only')
})
test('catalogue clearance cross-cuts families without merging alternative products',()=>{
 const rows=[p,{...p,id:'original_example',origin:'swarovski_strass',family:'surface'}]
 assert.equal(filterCrystalProducts(rows,{view:'clearance'}).length,1)
 assert.equal(filterCrystalProducts(rows,{view:'materials'}).length,1)
 assert.equal(filterCrystalProducts(rows,{search:'octagon',shape:'absent'}).length,0)
})
test('enquiry snapshots preserve source, exact variant, revisions and units',()=>{
 const line=crystalEnquiryLine(p,variant)
 const out=crystalEnquirySnapshot({...line,inventory_id:'secret',application:'Lighting renovation'})
 assert.equal(out.source_collection,'crystal_products');assert.equal(out.variant_id,variant.id);assert.equal(out.variant_revision,3);assert.equal(out.product_revision,5);assert.equal(out.unit,'pcs');assert.match(out.description_snapshot,/14 mm/);assert.equal(out.inventory_id,undefined)
 assert.throws(()=>crystalEnquiryLine({...p,publication:'archived'},variant))
})
test('exact sample identity cannot silently substitute a different photographed backing',()=>{
 assert.throws(()=>crystalEnquiryLine(p,{...variant,sample_id:'sw_example'}, {id:'sw_other',publication:'published'}))
 const line=crystalEnquiryLine(p,{...variant,sample_id:'sw_example'}, {id:'sw_example',publication:'published',revision:8})
 assert.equal(line.swatch_sample_id,'sw_example');assert.equal(line.swatch_revision,8)
})
const mapping={collection:'crystals',inventory_id:'stock_example',stock_unit:'pcs',catalogue_unit:'pcs',stock_per_unit:1,reviewed:true}
test('availability reads one shared stock minus reservations without mutating it',()=>{
 const stock={stock_qty:10,reserved_qty:4,cost:'secret'},before=JSON.stringify(stock)
 assert.equal(crystalStockAvailability(p,variant,mapping,stock).available,6);assert.equal(JSON.stringify(stock),before)
 assert.equal(crystalStockAvailability(p,variant,{...mapping,stock_per_unit:2},stock).available,3)
 assert.equal(crystalStockAvailability(p,variant,{...mapping,reviewed:false},stock).available,null)
 assert.equal(crystalStockAvailability(p,variant,{...mapping,catalogue_unit:'sheet'},stock).available,null)
 assert.equal(crystalStockAvailability(p,variant,mapping,{stock_qty:null}).available,null)
 assert.equal(crystalStockAvailability(p,variant,mapping,{stock_qty:10,reserved_qty:-5}).available,null)
 assert.equal(crystalStockAvailability(p,variant,mapping,{stock_qty:1,reserved_qty:4}).available,0)
 assert.match(crystalStockAvailability({...p,supply:'stock_only'},variant,mapping,{stock_qty:0}).message,/Sold out/)
})
const handler=(overrides={})=>createCrystalAvailabilityHandler({verifyToken:async()=>({uid:'customer_example'}),getProfile:async()=>({role:'customer',status:'approved'}),getProduct:async()=>p,getVariant:async()=>variant,getMapping:async()=>mapping,getStock:async()=>({stock_qty:10,reserved_qty:4,secret:'private'}),...overrides})
const req=(body={productId:p.id,variantId:variant.id},token='authorized.example.token')=>new Request('https://example.test/api/crystal-availability',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)})
test('server availability is an explicit customer-safe projection',async()=>{
 const res=await handler()(req()),text=await res.text()
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store')
 assert.equal(JSON.parse(text).availability.available,6)
 for(const hidden of ['inventory_id','stock_example','stock_qty','reserved_qty','secret','stock_per_unit'])assert.equal(text.includes(hidden),false)
})
for(const [name,override,status] of [
 ['pending',{getProfile:async()=>({role:'customer',status:'pending'})},403],
 ['supply-only staff',{getProfile:async()=>({role:'staff',modules:['supply']})},403],
 ['draft product',{getProduct:async()=>({...p,publication:'draft'})},404],
 ['archived variant',{getVariant:async()=>({...variant,publication:'archived'})},404],
 ['unconfirmed variant',{getVariant:async()=>({...variant,confirmed:false})},404],
 ['invalid token',{verifyToken:async()=>{throw Error()}},401],
 ['backend unavailable',{getStock:async()=>{throw Error()}},503],
])test('availability denies '+name,async()=>assert.equal((await handler(override)(req())).status,status))
test('availability invalid IDs and HTTP methods are bounded',async()=>{
 assert.equal((await handler()(req({productId:'../private',variantId:variant.id}))).status,400)
 assert.equal((await handler()(new Request('https://example.test'))).status,405)
})
test('product photo and drawing proxy forwards caller authentication to Storage rules',async()=>{
 let upstream
 const image=createSwatchImageHandler({bucket:'example.firebasestorage.app',fetcher:async(url,options)=>{upstream={url,options};return new Response('image',{headers:{'Content-Type':'image/jpeg'}})}})
 const path='crystal-products/cp_example/im_example/'+'a'.repeat(64)+'/display.jpg'
 const response=await image(new Request('https://example.test/api/swatch-library?action=image&file='+encodeURIComponent(path),{headers:{Authorization:'Bearer caller.token'}}))
 assert.equal(response.status,200);assert.equal(upstream.options.headers.Authorization,'Firebase caller.token');assert.equal(upstream.options.redirect,'error')
 assert.equal((await image(new Request('https://example.test/api/swatch-library?action=image&file=customers/private.jpg',{headers:{Authorization:'Bearer caller.token'}}))).status,400)
 const file=createSwatchImageHandler({bucket:'example.firebasestorage.app',fetcher:async()=>new Response('%PDF-',{headers:{'Content-Type':'application/pdf'}})})
 assert.equal((await file(new Request('https://example.test/?action=attachment&file=enquiry-files/owner/enquiry/file.pdf',{headers:{Authorization:'Bearer caller.token'}}))).headers.get('content-disposition'),'attachment')
})
