import {useEffect,useState} from 'react'
import {CRYSTAL_UNITS} from '../domain/crystalProducts'
import {saveCrystalVariant,loadCrystalMapping,saveCrystalMapping} from '../crystalProducts'
import {collection,getDocs} from 'firebase/firestore'
import {db} from '../firebase'
import {useCan} from '../access'
export default function CrystalVariantEditor({product,variant,samples,onSaved,onClose}) {
 const [id]=useState(()=>variant?.id||'v_'+crypto.randomUUID()),[v,setV]=useState(()=>variant||{code:'',label:'',size:'',colour:'',effect:'',holes:'',backing:'',unit:product.unit||'pcs',sample_id:'',confirmed:false,publication:'draft'})
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const patch=(k,value)=>setV(p=>({...p,[k]:value}))
 async function save(){setBusy(true);setError('');try{await saveCrystalVariant({productId:product.id,id,values:v,expectedRevision:variant?.revision||0});await onSaved();onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="card p-4 space-y-3" aria-label="Variant editor"><h3 className="eyebrow">{variant?'Edit variant':'Add actual variant'}</h3><div className="grid sm:grid-cols-2 gap-3">{[['code','Variant code'],['label','Variant description'],['size','Size / dimensions'],['colour','Crystal colour'],['effect','Effect'],['holes','Number of holes'],['backing','Backing colour / label']].map(([k,label])=><label key={k}><span className="label">{label}</span><input className="input" maxLength={k==='label'?200:100} value={v[k]||''} onChange={e=>patch(k,e.target.value)}/></label>)}
  <label><span className="label">Enquiry unit</span><select className="input" value={v.unit} onChange={e=>patch('unit',e.target.value)}>{Object.entries(CRYSTAL_UNITS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
 </div><label className="block"><span className="label">Exact photographed sample (optional)</span><select className="input" value={v.sample_id||''} onChange={e=>patch('sample_id',e.target.value)}><option value="">No sample linked</option>{samples.map(s=><option key={s.id} value={s.id}>{s.color_name} · {s.style} · {s.backing_label} · {s.id.slice(-8)}</option>)}</select></label>
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={v.confirmed} onChange={e=>patch('confirmed',e.target.checked)}/>Confirmed real combination; not generated from all possible options</label>
 <label className="block"><span className="label">Variant visibility</span><select className="input" value={v.publication} onChange={e=>patch('publication',e.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
 {error&&<p role="alert" className="text-sm text-brand-700">{error}</p>}<div className="flex gap-2"><button disabled={busy} className="btn-secondary min-h-11" onClick={save}>{busy?'Saving…':'Save variant'}</button><button disabled={busy} className="btn-ghost min-h-11" onClick={onClose}>Cancel variant</button></div></section>
}
export function CrystalStockLink({product,variant}) {
 const canSupply=useCan('supply'),[mapping,setMapping]=useState(null),[stocks,setStocks]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('')
 useEffect(()=>{setOpen(false);setMapping(null);setError('')},[variant.id,product.id])
 async function load(){setBusy(true);setError('');try{const [m,s]=await Promise.all([loadCrystalMapping(product.id,variant.id),getDocs(collection(db,'crystals'))]);setMapping(m||{inventory_id:'',stock_per_unit:1,reviewed:false,notes:''});setStocks(s.docs.map(d=>({...d.data(),id:d.id})));setOpen(true)}catch{setError('Stock link could not be loaded.')}finally{setBusy(false)}}
 async function save(){setBusy(true);setError('');try{await saveCrystalMapping(product.id,variant.id,{...mapping,catalogue_unit:variant.unit});setOpen(false)}catch(e){setError(e.message)}finally{setBusy(false)}}
 if(!canSupply)return null
 const stock=stocks.find(s=>s.id===mapping?.inventory_id),matches=stocks.filter(s=>s.id===mapping?.inventory_id||[s.code,s.name].join(' ').toLowerCase().includes(search.toLowerCase()))
 return <div className="space-y-3"><button className="btn-ghost min-h-11" disabled={busy} onClick={load}>Review stock link</button>{error&&<p role="alert" className="text-sm text-brand-700">{error}</p>}{open&&mapping&&<section className="bg-ivory p-3 space-y-3"><p className="eyebrow">Supply only · existing crystal ledger</p><p className="text-xs text-ink-60">This links availability; it never copies or changes stock. Confirm an order manually through the existing inventory process. Enquiries do not reserve anything.</p>
 <label className="block"><span className="label">Find inventory</span><input className="input" value={search} onChange={e=>setSearch(e.target.value)}/></label>
 <label className="block"><span className="label">Canonical inventory item</span><select className="input" value={mapping.inventory_id} onChange={e=>setMapping(m=>({...m,inventory_id:e.target.value,reviewed:false}))}><option value="">Choose stock</option>{matches.map(s=><option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
 {stock&&<p className="text-xs text-ink-60 break-words">{stock.code} · On hand: {stock.stock_qty??'unconfirmed'} pcs · Reserved: {stock.reserved_qty??0} pcs. Check the physical count and condition before clearance.</p>}
 <label className="block"><span className="label">Stock pieces per 1 {variant.unit}</span><input type="number" min="0.000001" max="1000000" step="any" className="input" value={mapping.stock_per_unit} onChange={e=>setMapping(m=>({...m,stock_per_unit:e.target.value,reviewed:false}))}/></label>
 <label className="block"><span className="label">Private provenance / stock review notes</span><textarea maxLength={2000} className="input" value={mapping.notes} onChange={e=>setMapping(m=>({...m,notes:e.target.value}))}/></label>
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={mapping.reviewed} onChange={e=>setMapping(m=>({...m,reviewed:e.target.checked}))}/>I verified the exact stock identity, unit conversion and current count for availability.</label>
 <div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-11" disabled={busy} onClick={save}>Save stock link</button><button className="btn-ghost min-h-11" onClick={()=>setOpen(false)}>Close stock link</button></div></section>}</div>
}
