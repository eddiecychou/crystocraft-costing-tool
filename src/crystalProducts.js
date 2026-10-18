import {collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp} from 'firebase/firestore'
import {db} from './firebase'
import {photoAssets} from './crystalSwatches'
import {cleanCrystalProduct,cleanCrystalVariant,draftFromCrystalStock,validCrystalId} from './domain/crystalProducts'
const records=s=>s.docs.map(d=>({...d.data(),id:d.id}))
export async function listCrystalProducts({includeDrafts=false}={}) {
 const col=collection(db,'crystal_products')
 return records(await getDocs(includeDrafts?col:query(col,where('publication','==','published'))))
}
export async function loadCrystalProduct(id,{includeDrafts=false}={}) {
 if(!validCrystalId(id))return null
 const ref=doc(db,'crystal_products',id),snap=await getDoc(ref)
 if(!snap.exists())return null
 const list=async child=>{const col=collection(ref,child);return records(await getDocs(includeDrafts?col:query(col,where('publication','==','published'))))}
 const [variants,images]=await Promise.all([list('variants'),list('images')])
 return {...snap.data(),id,variants,images,hero_media:images.find(i=>i.id===snap.data().hero_id)?.media||null}
}
async function saveRevision(ref,values,expectedRevision) {
 return runTransaction(db,async tx=>{
  const old=await tx.get(ref)
  if((old.exists()?old.data().revision:0)!==expectedRevision)throw Error('This record changed. Reload it before saving.')
  const revision=expectedRevision+1
  tx.set(ref,{...values,revision,created_at:old.exists()?old.data().created_at:serverTimestamp(),updated_at:serverTimestamp()})
  return revision
 })
}
export const saveCrystalProduct=({id,values,expectedRevision=0})=>saveRevision(doc(db,'crystal_products',id),cleanCrystalProduct({...values,publication:expectedRevision?values.publication:'draft'}),expectedRevision)
export const saveCrystalVariant=({productId,id,values,expectedRevision=0})=>saveRevision(doc(db,'crystal_products',productId,'variants',id),cleanCrystalVariant(values),expectedRevision)
export async function saveCrystalImage({productId,id,file,alt,publication='published',expectedRevision=0,onPrepared}) {
 const ref=doc(db,'crystal_products',productId,'images',id)
 let current=expectedRevision,media
 if(!current){current=await saveRevision(ref,{alt:String(alt||'').slice(0,200),publication:'draft',media:null},0);onPrepared?.(current)}
 if(file)media=await photoAssets(productId,file,null,(_,hash,mime)=>{
  const base='crystal-products/'+productId+'/'+id+'/'+hash
  return {original:base+'/original.'+(mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'),display:base+'/display.jpg',thumbnail:base+'/thumbnail.jpg'}
 })
 const previous=await getDoc(ref)
 return saveRevision(ref,{alt:String(alt||'').slice(0,200),publication,media:media||previous.data()?.media||null},current)
}
export async function loadCrystalMapping(productId,variantId) {
 const snap=await getDoc(doc(db,'crystal_product_private',productId,'variants',variantId));return snap.exists()?snap.data():null
}
export async function saveCrystalMapping(productId,variantId,values) {
 const ref=doc(db,'crystal_product_private',productId,'variants',variantId)
 if(!validCrystalId(values.inventory_id)||!Number.isFinite(Number(values.stock_per_unit))||Number(values.stock_per_unit)<=0)throw Error('Choose the inventory item and confirm a positive unit conversion.')
 const record={collection:'crystals',inventory_id:values.inventory_id,stock_unit:'pcs',catalogue_unit:values.catalogue_unit,stock_per_unit:Number(values.stock_per_unit),reviewed:values.reviewed===true,notes:String(values.notes||'').slice(0,2000),updated_at:serverTimestamp()}
 await runTransaction(db,async tx=>{const v=await tx.get(doc(db,'crystal_products',productId,'variants',variantId)),stock=await tx.get(doc(db,'crystals',record.inventory_id));if(!v.exists()||!stock.exists())throw Error('Variant or inventory item no longer exists.');if(v.data().unit!==record.catalogue_unit)throw Error('Units changed. Review the conversion again.');tx.set(ref,record)})
}
export async function createCrystalStockDraft(stock,origin) {
 const p=draftFromCrystalStock(stock,origin),pref=doc(db,'crystal_products',p.id),vref=doc(pref,'variants','stock'),mref=doc(db,'crystal_product_private',p.id,'variants','stock')
 await runTransaction(db,async tx=>{
  const old=await tx.get(pref),live=await tx.get(doc(db,'crystals',stock.id))
  if(old.exists())throw Error('A draft for this stock item already exists. Open the existing catalogue record.')
  if(!live.exists()||live.data().code!==stock.code||live.data().name!==stock.name)throw Error('Stock description changed. Reload the inventory list.')
  const stamp={revision:1,created_at:serverTimestamp(),updated_at:serverTimestamp()}
  tx.set(pref,{...cleanCrystalProduct(p),...stamp})
  tx.set(vref,{...cleanCrystalVariant({code:stock.code,label:stock.name||stock.code,unit:'pcs',publication:'draft',confirmed:false}),...stamp})
  tx.set(mref,{collection:'crystals',inventory_id:stock.id,stock_unit:'pcs',catalogue_unit:'pcs',stock_per_unit:1,reviewed:false,notes:'Selected from existing crystal inventory. Identity, condition and count require review; no stock movement was made.',updated_at:serverTimestamp()})
 })
 return p.id
}
