import {useEffect,useState} from 'react'
import {Link,useParams} from 'react-router-dom'
import {loadCrystalProduct} from '../crystalProducts'
import {listCrystalSwatches} from '../crystalSwatches'
import {CRYSTAL_FAMILIES,CRYSTAL_ORIGINS,CRYSTAL_SUPPLY,CRYSTAL_UNITS,crystalVariantDescription,crystalEnquiryLine} from '../domain/crystalProducts'
import {useCart,useFavourites} from './store'
import useCrystalAvailability from '../hooks/useCrystalAvailability'
import SwatchPhoto from '../components/SwatchPhoto'
import LoadingBar from '../components/LoadingBar'
export default function CrystalComponentDetail() {
 const {id}=useParams(),cart=useCart(),fav=useFavourites()
 const [p,setP]=useState(null),[samples,setSamples]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[variantId,setVariantId]=useState(''),[sampleId,setSampleId]=useState(''),[photoId,setPhotoId]=useState(''),[qty,setQty]=useState(1),[application,setApplication]=useState(''),[note,setNote]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{let alive=true;setLoading(true);setP(null);setError('');setVariantId('');setSampleId('');Promise.all([loadCrystalProduct(id),listCrystalSwatches()]).then(([product,swatches])=>{if(alive){setP(product);setPhotoId(product?.hero_id||'');setSamples(swatches)}}).catch(()=>{if(alive)setError('This component is unavailable or could not be loaded. Please retry or return to the catalogue.')}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[id,retry])
 const variant=p?.variants.find(v=>v.id===variantId),sample=samples.find(s=>s.id===(variant?.sample_id||sampleId)),image=p?.images.find(i=>i.id===photoId)
 const av=useCrystalAvailability(p?.id,variant?.id),isMaterial=p&&p.family!=='cut'
 let line=null
 if(p&&variant){try{line=crystalEnquiryLine(p,variant,sample)}catch{}}
 const added=line&&cart.has(line),selectedSamples=samples.filter(s=>!isMaterial||(p.family==='fabric'?s.style==='fabric':s.style!=='fabric'))
 function add(){setError('');try{cart.add({...crystalEnquiryLine(p,variant,sample),qty:Math.max(1,Number(qty)||1),application,note});}catch(e){setError(e.message)}}
 if(loading)return <LoadingBar/>
 return <div className="py-12 md:py-16 space-y-8"><Link to="/shop/crystal-components" className="text-brand-600 text-sm inline-flex min-h-11 items-center">← Crystal Components</Link>
 {error&&<div role="alert" className="card p-4 text-sm text-brand-700">{error}{!p&&<button className="btn-ghost min-h-11" onClick={()=>setRetry(n=>n+1)}>Retry component</button>}</div>}
 {!p&&!error&&<section className="card p-6"><h1 className="text-xl">Component unavailable</h1><p className="text-sm text-ink-60 mt-3">This item is no longer published. Please return to the catalogue.</p></section>}
 {p&&<><div className="grid md:grid-cols-2 gap-8"><section className="space-y-3" aria-label="Product photographs"><div className="aspect-square bg-white border border-ivory-dark">{image?.media?<SwatchPhoto path={image.media.display} alt={image.alt||p.name}/>:<p className="p-4 text-sm text-ink-60">Photograph unavailable</p>}</div><div className="flex gap-2 flex-wrap">{p.images.filter(i=>i.media).map(i=><button key={i.id} className={'w-20 h-20 border '+(photoId===i.id?'border-brand-500':'border-ivory-dark')} aria-label={i.alt||'Product photograph'} aria-pressed={photoId===i.id} onClick={()=>setPhotoId(i.id)}><SwatchPhoto path={i.media.thumbnail} alt={i.alt||p.name}/></button>)}</div></section>
 <section className="space-y-4"><div><p className="eyebrow mb-2">{CRYSTAL_ORIGINS[p.origin]}</p><h1 className="text-2xl md:text-3xl break-words">{p.name}</h1><p className="text-xs text-ink-60 mt-2">{p.code} · {CRYSTAL_FAMILIES[p.family]}</p></div><p className="text-sm text-ink-70 whitespace-pre-wrap">{p.description}</p><p className="text-sm">{CRYSTAL_SUPPLY[p.supply]}</p>
 {p.article_reference&&<p className="text-sm text-ink-70">{p.origin==='swarovski_strass'?'Original article: ':'Comparison reference: '}{p.article_reference}</p>}
 {p.origin==='swarovski_strass'&&<div className="card p-4 space-y-2"><p className="eyebrow">Original stock clearance</p><p className="text-sm text-ink-70">Available from our existing stock only. No replenishment. Quantities and condition are confirmed before an order is accepted.</p><p className="text-sm whitespace-pre-wrap">{p.condition}</p></div>}
 <label className="block"><span className="label">Select an actual variant</span><select className="input" value={variantId} onChange={e=>{setVariantId(e.target.value);setSampleId('')}}><option value="">Choose a size / colour combination</option>{p.variants.filter(v=>v.confirmed).map(v=><option key={v.id} value={v.id}>{v.code} · {crystalVariantDescription(v)}</option>)}</select></label>
 {isMaterial&&variant&&!variant.sample_id&&<label className="block"><span className="label">Photographed reference (optional)</span><select className="input" value={sampleId} onChange={e=>setSampleId(e.target.value)}><option value="">Discuss a custom finish</option>{selectedSamples.map(s=><option key={s.id} value={s.id}>{s.color_name} · {s.style} · backing {s.backing_label}</option>)}</select></label>}
 {sample&&<div className="flex items-center gap-3"><div className="h-24 w-24 shrink-0"><SwatchPhoto path={sample.media.thumbnail} alt={sample.color_name}/></div><p className="text-xs text-ink-60">{sample.color_name} · {sample.style} · backing {sample.backing_label}. Photographed reference, revision {sample.revision}.</p></div>}
 {variant&&<div className="space-y-2"><p className="text-sm text-ink-70">{av.loading?'Checking availability…':av.result?.message||'Availability needs confirmation.'}</p>{!av.loading&&!av.result&&<button className="text-brand-600 text-sm min-h-11" onClick={av.retry}>Retry availability</button>}<label className="block"><span className="label">Requested quantity ({CRYSTAL_UNITS[variant.unit]})</span><input type="number" min="1" step="1" className="input" value={qty} onChange={e=>setQty(e.target.value)}/></label></div>}
 {isMaterial&&<p className="text-sm text-ink-70">We quote from your drawing and application. Add a drawing or reference file on the enquiry page; an early enquiry is welcome before the drawing is ready.</p>}
 <label className="block"><span className="label">Intended application</span><textarea rows={2} maxLength={2000} className="input" placeholder="Lighting, decoration, surface application…" value={application} onChange={e=>setApplication(e.target.value)}/></label>
 <label className="block"><span className="label">Notes (optional)</span><textarea maxLength={2000} rows={2} className="input" placeholder={isMaterial?'Dimensions, adhesive preference, effects or deadline; not sure is fine.':'Project details, deadline or questions.'} value={note} onChange={e=>setNote(e.target.value)}/></label>
 <p className="text-sm text-ink-60">Price on quotation. An enquiry does not reserve stock.</p>
 <div className="flex flex-wrap gap-3"><button className="btn-primary min-h-11" disabled={!line||added||av.result?.verified&&av.result.available===0&&p.supply==='stock_only'} onClick={add}>{added?'Added to enquiry':'Request a quote'}</button><button className="btn-secondary min-h-11" onClick={()=>fav.toggle({type:'crystal_component',id:p.id,name:p.name,code:p.code,image:''}).catch(()=>setError('Could not update favourites. Please retry.'))}>{fav.has('crystal_component',p.id)?'Remove from favourites':'Save to favourites'}</button></div>
 {added&&<Link className="text-brand-600 text-sm inline-flex min-h-11 items-center" to="/shop/enquiry">Review enquiry →</Link>}
 </section></div></>}
 </div>
}
