import {ref,uploadBytes} from 'firebase/storage'
import {doc,getDoc} from 'firebase/firestore'
import {auth,db,storage,authedUser} from './firebase'
import {validatePhoto,sha256} from './domain/crystalSwatches'
import {loadCrystalProduct} from './crystalProducts'
export async function validateCrystalEnquirySelections(items) {
 for(const item of items.filter(i=>i.type==='crystal_component')){
  const p=await loadCrystalProduct(item.id),v=p?.variants.find(v=>v.id===item.variant_id)
  if(!p||p.publication!=='published'||!v?.confirmed||v.publication!=='published'||p.revision!==item.product_revision||v.revision!==item.variant_revision||v.unit!==item.unit)throw Error('A component selection changed. Open the component and reselect its options before sending.')
 }
 for(const item of items.filter(i=>['crystal_component','crystal_fabric','swatch_sample'].includes(i.type))){
  if(item.swatch_sample_id){const sample=await getDoc(doc(db,'crystal_swatches',item.swatch_sample_id));if(!sample.exists()||sample.data().publication!=='published'||sample.data().revision!==item.swatch_revision)throw Error('A reference sample changed. Please reselect it before sending.')}
  else if(item.type==='swatch_sample')throw Error('Please reselect the photographed sample before sending.')
 }
}
export async function uploadEnquiryDrawing(enquiryId,file,fileId) {
 if(!file||file.size<=0||file.size>20*1024*1024)throw Error('Drawing must be a PDF, JPEG, PNG or WebP up to 20 MB.')
 const bytes=await file.arrayBuffer(),type=file.type
 if(type==='application/pdf'){if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Choose a valid PDF.')}
 else validatePhoto(bytes,type)
 const ext=type==='application/pdf'?'pdf':type==='image/png'?'png':type==='image/webp'?'webp':'jpg'
 const path='enquiry-files/'+auth.currentUser.uid+'/'+enquiryId+'/'+fileId+'.'+ext,hash=await sha256(bytes)
 try{await uploadBytes(ref(storage,path),file,{contentType:type,cacheControl:'private, no-cache'})}catch(e){if(e.code!=='storage/unauthorized')throw e}
 const blob=await readEnquiryAttachment(path)
 if(await sha256(await blob.arrayBuffer())!==hash)throw Error('Drawing upload could not be verified. Please retry.')
 return {path,name:file.name.slice(0,200),mime:type,bytes:file.size,sha256:hash}
}
export async function readEnquiryAttachment(path) {
 const user=await authedUser()
 const res=await fetch('/api/swatch-library?action=attachment&file='+encodeURIComponent(path),{headers:{Authorization:'Bearer '+await user.getIdToken()},cache:'no-store'})
 if(!res.ok)throw Error('Drawing could not be loaded. Please retry.')
 return res.blob()
}
export async function downloadEnquiryAttachment(attachment) {
 const blob=await readEnquiryAttachment(attachment.path),url=URL.createObjectURL(blob),a=document.createElement('a')
 a.href=url;a.download=attachment.name||'Drawing';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
