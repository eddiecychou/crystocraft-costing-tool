import {useEffect,useState} from 'react'
import {Link,useNavigate,useParams} from 'react-router-dom'
import {loadCrystalProduct,saveCrystalProduct} from '../crystalProducts'
import {listCrystalSwatches} from '../crystalSwatches'
import {CRYSTAL_FAMILIES,CRYSTAL_ORIGINS,CRYSTAL_SUPPLY,CRYSTAL_UNITS,crystalVariantDescription} from '../domain/crystalProducts'
import CrystalVariantEditor,{CrystalStockLink} from '../components/CrystalVariantEditor'
import CrystalProductImages from '../components/CrystalProductImages'
import CrystalSupplierCosting from '../components/CrystalSupplierCosting'
import LoadingBar from '../components/LoadingBar'
const empty={code:'',name:'',description:'',family:'cut',origin:'crystocraft',supply:'made_to_order',shape:'',article_reference:'',condition:'',provenance_reviewed:false,unit:'pcs',publication:'draft',hero_id:'',primary_variant_id:'',sort_order:0}
export default function CrystalComponentForm() {
 const {id}=useParams()
 return <CrystalComponentEditor key={id}/>
}
function CrystalComponentEditor() {
 const {id:routeId}=useParams(),[newId]=useState(()=>'cp_'+crypto.randomUUID()),id=routeId==='new'?newId:routeId,navigate=useNavigate()
 const [p,setP]=useState(null),[values,setValues]=useState(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(null),[samples,setSamples]=useState([]),[imageBusy,setImageBusy]=useState(false)
 const working=busy||imageBusy
 async function reload(){const next=await loadCrystalProduct(id,{includeDrafts:true});setP(next);if(next)setValues(next);return next}
 useEffect(()=>{let alive=true;setLoading(true);setError('');Promise.all([routeId==='new'?Promise.resolve(null):loadCrystalProduct(id,{includeDrafts:true}),listCrystalSwatches({includeDrafts:true})]).then(([next,swatches])=>{if(alive){setP(next);setValues(next||empty);setSamples(swatches);if(!next&&routeId!=='new')setError('Component not found.')}}).catch(()=>{if(alive)setError('Component could not be loaded. Return to the catalogue and retry.')}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[routeId,id])
 async function refreshImages(){const next=await loadCrystalProduct(id,{includeDrafts:true});if(!next)throw Error('Component not found.');setP(current=>current?{...current,images:next.images,hero_media:next.hero_media}:next)}
 const patch=(k,v)=>setValues(old=>({...old,[k]:v}))
 async function save(e){e.preventDefault();if(working)return;setBusy(true);setError('');try{await saveCrystalProduct({id,values,expectedRevision:p?.revision||0});if(routeId==='new')navigate('/crystal-components/'+id,{replace:true});else await reload()}catch(e){setError(e.message)}finally{setBusy(false)}}
 if(loading)return <LoadingBar/>
 return <div className="p-4 md:p-6 max-w-5xl space-y-4"><Link className="text-sm text-brand-600 inline-flex min-h-11 items-center" to="/crystal-components">← Crystal Components</Link><h1 className="text-2xl">{p?'Edit component':'New component'}</h1>
 {error&&<p role="alert" className="card p-4 text-sm text-brand-700 break-words">{error}</p>}
 {(p||routeId==='new')&&<><form onSubmit={save} className="card p-4 space-y-4"><p className="eyebrow">Customer-visible catalogue content</p><div className="grid sm:grid-cols-2 gap-4">
 { [['code','Catalogue code'],['name','Product name'],['shape','Shape'],['article_reference',values.origin==='swarovski_strass'?'Original article reference':'Comparison reference (optional)']].map(([k,label])=><label key={k}><span className="label">{label}</span><input required={k==='code'||k==='name'} maxLength={k==='name'?200:100} className="input" value={values[k]} onChange={e=>patch(k,e.target.value)}/></label>)}
 { [['family','Product family',CRYSTAL_FAMILIES],['origin','Origin · fixed after creation',CRYSTAL_ORIGINS],['supply','Supply treatment',CRYSTAL_SUPPLY],['unit','Default enquiry unit',CRYSTAL_UNITS]].map(([k,label,options])=><label key={k}><span className="label">{label}</span><select disabled={k==='origin'&&!!p} className="input" value={values[k]} onChange={e=>setValues(v=>({...v,[k]:e.target.value,...(k==='origin'?{supply:e.target.value==='swarovski_strass'?'stock_only':'made_to_order',provenance_reviewed:false}:{})}))}>{Object.entries(options).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>)}
 </div><label className="block"><span className="label">Description / confirmed applications</span><textarea className="input" rows={3} maxLength={2000} value={values.description} onChange={e=>patch('description',e.target.value)}/></label>
 {values.origin==='swarovski_strass'&&<div className="space-y-3"><label className="block"><span className="label">Customer-visible stock condition</span><textarea maxLength={500} className="input" value={values.condition} onChange={e=>patch('condition',e.target.value)} placeholder="Describe the inspected condition and packaging."/></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={values.provenance_reviewed} onChange={e=>patch('provenance_reviewed',e.target.checked)}/>Original Swarovski / Strass provenance and article identity have been reviewed.</label><p className="text-xs text-ink-60">Before publishing, Supply must also review the primary variant’s stock link and current count. Stock only, no replenishment. This is not a claim that Swarovski has discontinued the article worldwide.</p></div>}
 {p&&<div className="grid sm:grid-cols-2 gap-4"><label><span className="label">Cover photograph</span><select disabled={working} className="input" value={values.hero_id} onChange={e=>patch('hero_id',e.target.value)}><option value="">Choose a published photograph</option>{p.images.filter(i=>i.publication==='published'&&i.media).map(i=><option key={i.id} value={i.id}>{i.alt||i.id}</option>)}</select></label><label><span className="label">Primary variant</span><select className="input" value={values.primary_variant_id} onChange={e=>patch('primary_variant_id',e.target.value)}><option value="">Choose a confirmed published variant</option>{p.variants.filter(v=>v.publication==='published'&&v.confirmed).map(v=><option key={v.id} value={v.id}>{v.code} · {v.label}</option>)}</select></label></div>}
 <div className="grid sm:grid-cols-2 gap-4"><label><span className="label">Visibility</span><select disabled={!p} className="input" value={values.publication} onChange={e=>patch('publication',e.target.value)}><option value="draft">Draft · OC only</option><option value="published">Published · approved customers</option><option value="archived">Archived · OC only</option></select></label><label><span className="label">Display order</span><input type="number" className="input" min="0" max="100000" step="1" value={values.sort_order} onChange={e=>patch('sort_order',e.target.value)}/></label></div>
 {!p&&<p className="text-xs text-ink-60">Save a draft first, then add photographs and actual variants. Stock balances stay in Inventory.</p>}
 <button className="btn-primary min-h-11" disabled={working}>{busy?'Saving…':p?'Save component':'Create draft'}</button></form>
 {p&&<><CrystalProductImages key={id} product={p} name={values.name||p.name} coverId={values.hero_id} disabled={busy} onBusyChange={setImageBusy} onChooseCover={imageId=>patch('hero_id',imageId)} onRefresh={refreshImages}/>
 <section className="card p-4 space-y-3"><div className="flex justify-between gap-3 items-center"><h2 className="eyebrow">Actual variants</h2><button disabled={working} className="btn-secondary min-h-11" onClick={()=>setEditing({new:true})}>Add variant</button></div>
 {!p.variants.length&&<p className="text-sm text-ink-60">Add the size, colour, holes and backing combinations you actually offer.</p>}
 {p.variants.map(v=><div key={v.id} className="border-t border-ivory-dark py-3 space-y-1"><div className="flex flex-wrap justify-between gap-2"><div className="min-w-0 break-words"><p className="text-sm">{v.code} · {v.publication}</p><p className="text-xs text-ink-60">{crystalVariantDescription(v)} · {CRYSTAL_UNITS[v.unit]}</p></div><button disabled={working} className="btn-ghost min-h-11" onClick={()=>setEditing(v)}>Edit variant</button></div><CrystalStockLink product={p} variant={v}/></div>)}
 </section>
 <CrystalSupplierCosting product={p}/>
 {editing&&<CrystalVariantEditor key={editing.id||'new'} product={p} variant={editing.new?null:editing} samples={samples} onSaved={reload} onClose={()=>setEditing(null)}/>}
 </>}
 </>}
 </div>
}
