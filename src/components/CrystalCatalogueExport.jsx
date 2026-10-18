import {pdf} from '@react-pdf/renderer'
import CrystalCataloguePDF from './CrystalCataloguePDF'
import {loadCrystalProduct} from '../crystalProducts'
import {readSwatchPhoto} from '../crystalSwatches'
const dataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})
export async function downloadCrystalCatalogue(selection,title) {
 if(!selection.length||selection.length>100)throw Error('Select between 1 and 100 published components.')
 const products=[]
 // Sequential verification bounds memory and image/API pressure on large ranges.
 for(const row of selection){
  const p=await loadCrystalProduct(row.id)
  if(!p||p.publication!=='published')throw Error('The catalogue changed. Refresh the selection and try again.')
  if(!p.hero_media?.display)throw Error('A cover photograph is missing. Please refresh the catalogue.')
  const photo=await dataURL(await readSwatchPhoto(p.hero_media.display))
  products.push({...p,photo,variants:p.variants.filter(v=>v.publication==='published'&&v.confirmed)})
 }
 const blob=await pdf(<CrystalCataloguePDF products={products} title={title}/>).toBlob(),url=URL.createObjectURL(blob),a=document.createElement('a')
 a.href=url;a.download='Crystocraft Crystal Components.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
