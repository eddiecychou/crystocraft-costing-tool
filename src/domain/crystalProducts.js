// Customer-safe descriptions. Stock and supplier facts live elsewhere.
export const CRYSTAL_FAMILIES = {cut:'Cut Crystal Components',fabric:'Crystal Fabrics',surface:'Crystal Surfaces'}
export const CRYSTAL_ORIGINS = {crystocraft:'Crystocraft Components',swarovski_strass:'Original Swarovski / Strass'}
export const CRYSTAL_SUPPLY = {made_to_order:'Made to order',stock_and_made:'Stock and made to order',stock_only:'Clearance · stock only'}
export const CRYSTAL_UNITS = {pcs:'pieces',sheet:'sheets',metre:'metres',sqm:'square metres',project:'projects'}
export const CATALOGUE_VIEWS = {all:'All components',cut:'Cut Crystal Components',materials:'Crystal Fabrics and Surfaces',clearance:'Original Swarovski Stock'}
export const validCrystalId = id => typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
const text=(v,max=100)=>String(v??'').trim().slice(0,max)
const choice=(v,options)=>{if(!Object.hasOwn(options,v))throw Error('Choose a valid catalogue option.');return v}
export function cleanCrystalProduct(v) {
 const d={schema_version:1,code:text(v.code),name:text(v.name,200),description:text(v.description,2000),family:choice(v.family,CRYSTAL_FAMILIES),origin:choice(v.origin,CRYSTAL_ORIGINS),supply:choice(v.supply,CRYSTAL_SUPPLY),shape:text(v.shape),article_reference:text(v.article_reference),condition:text(v.condition,500),provenance_reviewed:v.provenance_reviewed===true,unit:choice(v.unit,CRYSTAL_UNITS),publication:choice(v.publication,{draft:1,published:1,archived:1}),hero_id:text(v.hero_id,128),primary_variant_id:text(v.primary_variant_id,128),sort_order:Math.max(0,Math.min(100000,Math.floor(Number(v.sort_order)||0)))}
 if(!d.code || !d.name)throw Error('Enter a catalogue code and name.')
 if(d.origin==='swarovski_strass' && d.supply!=='stock_only')throw Error('Original Swarovski / Strass stock must be stock only.')
 if(d.publication==='published'){
  if(!validCrystalId(d.hero_id)||!validCrystalId(d.primary_variant_id))throw Error('Add a published photograph and a confirmed published variant before publishing.')
  if(d.origin==='swarovski_strass' && (!d.provenance_reviewed||!d.condition||!d.article_reference))throw Error('Confirm original-stock provenance, article and condition before publishing.')
 }
 return d
}
export function cleanCrystalVariant(v) {
 const d={code:text(v.code),label:text(v.label,200),size:text(v.size),colour:text(v.colour),effect:text(v.effect),holes:text(v.holes),backing:text(v.backing),unit:choice(v.unit,CRYSTAL_UNITS),sample_id:text(v.sample_id,128),confirmed:v.confirmed===true,publication:choice(v.publication,{draft:1,published:1,archived:1})}
 if(!d.code||!d.label)throw Error('Enter the variant code and description.')
 if(d.sample_id && !validCrystalId(d.sample_id))throw Error('Choose a valid photographed sample.')
 if(d.publication==='published' && !d.confirmed)throw Error('Confirm this is a real available combination before publishing it.')
 return d
}
export const crystalVariantDescription=v=>[v.label,v.size,v.colour,v.effect,v.holes&&v.holes+' holes',v.backing&&'Backing: '+v.backing].filter(Boolean).join(' · ')
export function filterCrystalProducts(products,{view='all',search='',shape='',supply=''}={}) {
 const q=search.trim().toLowerCase()
 return products.filter(p=>(view==='all'||(view==='cut'?p.family==='cut':view==='materials'?['fabric','surface'].includes(p.family):p.origin==='swarovski_strass'))&&(!shape||p.shape===shape)&&(!supply||p.supply===supply)&&(!q||[p.name,p.code,p.description,p.article_reference,p.shape].join(' ').toLowerCase().includes(q))).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.code.localeCompare(b.code))
}
export function crystalEnquiryLine(product,variant,sample=null) {
 if(product.publication!=='published'||variant.publication!=='published'||!variant.confirmed)throw Error('This selection is no longer published. Please choose again.')
 if(sample && sample.publication!=='published')throw Error('The photographed sample is no longer published.')
 if(variant.sample_id && (!sample||sample.id!==variant.sample_id||sample.publication!=='published'))throw Error('The photographed sample needs to be reselected.')
 return {type:'crystal_component',id:product.id,source_collection:'crystal_products',variant_id:variant.id,product_revision:product.revision,variant_revision:variant.revision,name:product.name,code:variant.code,description_snapshot:[crystalVariantDescription(variant),sample&&'Reference sample: '+sample.color_name+' / '+sample.style+' / backing '+sample.backing_label].filter(Boolean).join(' · '),origin:product.origin,supply:product.supply,unit:variant.unit,finish:variant.backing||'',color:variant.colour||'',color_name:variant.colour||'',image:'',image_path:product.hero_media?.thumbnail||'',swatch_sample_id:sample?.id||'',swatch_revision:sample?.revision||null,application:'',note:'',qty:1,ws_price_usd:null}
}
export function crystalEnquirySnapshot(i) {
 return {source_collection:'crystal_products',variant_id:text(i.variant_id,128),product_revision:Number(i.product_revision)||null,variant_revision:Number(i.variant_revision)||null,description_snapshot:text(i.description_snapshot,1000),origin:text(i.origin),supply:text(i.supply),unit:choice(i.unit,CRYSTAL_UNITS),image_path:text(i.image_path,600),application:text(i.application,2000),swatch_sample_id:text(i.swatch_sample_id,128),swatch_revision:Number(i.swatch_revision)||null}
}
export function crystalStockAvailability(product,variant,mapping,stock) {
 const unknown={verified:false,available:null,unit:variant.unit,message:'Availability needs confirmation.'}
 if(!mapping?.reviewed || !stock || mapping.collection!=='crystals' || mapping.stock_unit!=='pcs' || mapping.catalogue_unit!==variant.unit || !Number.isFinite(mapping.stock_per_unit)||mapping.stock_per_unit<=0 || !Number.isFinite(stock.stock_qty) || stock.stock_qty<0 || (stock.reserved_qty!=null&&(!Number.isFinite(stock.reserved_qty)||stock.reserved_qty<0)))return unknown
 const available=Math.max(0,(stock.stock_qty-(stock.reserved_qty||0))/mapping.stock_per_unit)
 if(!Number.isFinite(available))return unknown
 const count=variant.unit==='pcs'?Math.floor(available):Math.floor(available*1000)/1000
 return {verified:true,available:count,unit:variant.unit,message:count>0?count.toLocaleString('en-US')+' '+CRYSTAL_UNITS[variant.unit]+' available · subject to confirmation.':product.supply==='stock_only'?'Sold out · no replenishment.':'Made to order · request lead time.'}
}
export function draftFromCrystalStock(stock,origin) {
 if(!validCrystalId(stock.id))throw Error('Choose an existing inventory item.')
 return {id:'cp_stock_'+stock.id,code:stock.code,name:stock.name||stock.code,description:'',family:'cut',origin,supply:origin==='swarovski_strass'?'stock_only':'stock_and_made',shape:'',article_reference:'',condition:'',provenance_reviewed:false,unit:'pcs',publication:'draft',hero_id:'',primary_variant_id:'stock',sort_order:0}
}
