import {useEffect,useState} from 'react'
import {Link,useNavigate,useSearchParams} from 'react-router-dom'
import {collection,getDocs} from 'firebase/firestore'
import {db} from '../firebase'
import {useCan} from '../access'
import {listCrystalProducts,createCrystalStockDraft} from '../crystalProducts'
import {listCrystalSwatches} from '../crystalSwatches'
import {fabricCatalogueEntry} from '../domain/crystalFabric'
import SwatchPhoto from '../components/SwatchPhoto'
import {CATALOGUE_VIEWS,CRYSTAL_ORIGINS,CRYSTAL_SUPPLY,filterCrystalProducts} from '../domain/crystalProducts'
import CrystalProductPhoto from '../components/CrystalProductPhoto'
import LoadingBar from '../components/LoadingBar'
export default function CrystalComponents() {
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState(''),[params,setParams]=useSearchParams()
 const [stocks,setStocks]=useState(null),[stockSearch,setStockSearch]=useState('Strass'),[selected,setSelected]=useState(''),[origin,setOrigin]=useState('swarovski_strass'),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false)
 const supply=useCan('supply'),navigate=useNavigate(),view=params.get('view')||'all'
 const load=()=>{setLoading(true);setError('');Promise.all([listCrystalProducts({includeDrafts:true}),listCrystalSwatches()]).then(([products,samples])=>{const fabric=fabricCatalogueEntry(samples);setRows([...products,...(fabric?[fabric]:[])])}).catch(()=>setError('Catalogue could not be loaded. Please retry.')).finally(()=>setLoading(false))}
 useEffect(load,[])
 async function openStock(){setError('');try{setStocks((await getDocs(collection(db,'crystals'))).docs.map(d=>({...d.data(),id:d.id})))}catch{setError('Stock records could not be loaded. Please retry.')}}
 async function makeDraft(){setError('');setBusy(true);try{const stock=stocks.find(s=>s.id===selected);const id=await createCrystalStockDraft(stock,origin);navigate('/crystal-components/'+id)}catch(e){setError(e.message)}finally{setBusy(false)}}
 const filtered=filterCrystalProducts(rows,{view,search}),matches=(stocks||[]).filter(s=>[s.code,s.name].join(' ').toLowerCase().includes(stockSearch.toLowerCase()))
 return <div className="p-4 md:p-6 space-y-4">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow mb-1">Catalogue</p><h1 className="text-2xl">Crystal Components</h1><p className="text-sm text-ink-60 mt-1">Own components, Crystal Fabric and original Swarovski / Strass clearance. Enquiry first.</p></div><Link to="/crystal-components/new" className="btn-primary min-h-11">New component</Link></header>
  <div className="flex flex-wrap gap-3">{!loading&&!rows.some(p=>p.catalogue_kind==='fabric')&&<Link to="/swatch-library" className="btn-secondary min-h-11">Manage fabric swatches</Link>}{supply&&<button className="btn-secondary min-h-11" onClick={openStock}>Prepare from existing stock</button>}</div>
  {stocks&&<section className="card p-4 space-y-3" aria-label="Prepare stock draft"><h2 className="eyebrow">Review existing stock</h2><p className="text-sm text-ink-60">Select one physical inventory item. A private catalogue draft and an unconfirmed stock link will be created. No stock quantity changes.</p>
   <label className="block"><span className="label">Find stock code or description</span><input className="input" value={stockSearch} onChange={e=>{setStockSearch(e.target.value);setSelected('');setReviewed(false)}}/></label>
   <label className="block"><span className="label">Existing inventory item</span><select className="input" value={selected} onChange={e=>{setSelected(e.target.value);setReviewed(false)}}><option value="">Choose one of {matches.length} matching records</option>{matches.map(s=><option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
   <label className="block"><span className="label">Catalogue origin (cannot change later)</span><select className="input" value={origin} onChange={e=>{setOrigin(e.target.value);setReviewed(false)}}>{Object.entries(CRYSTAL_ORIGINS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>I have checked this stock identity and origin for a draft. Article, specifications, condition, photograph and count still need review before publication.</span></label>
   <div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-11" disabled={busy||!reviewed||!selected} onClick={makeDraft}>{busy?'Preparing…':'Create reviewed draft'}</button><button className="btn-ghost min-h-11" onClick={()=>setStocks(null)}>Close stock review</button></div>
  </section>}
  <div className="flex flex-wrap gap-2">{Object.entries(CATALOGUE_VIEWS).map(([k,v])=><button key={k} className={'tag '+(view===k?'bg-ink text-white':'')} onClick={()=>setParams(k==='all'?{}:{view:k})}>{v}</button>)}</div>
  <label className="block"><span className="sr-only">Search components</span><input className="input" placeholder="Search name, code, article or shape" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  {loading&&<LoadingBar/>}{error&&<div role="alert" className="card p-4 text-sm text-brand-700">{error}<button className="btn-ghost min-h-11" onClick={load}>Retry catalogue</button></div>}
  {!loading&&!error&&!filtered.length&&<div className="card p-6 space-y-3"><p className="eyebrow">No components in this view yet</p><p className="text-sm text-ink-60">Create a component or prepare a stock draft, then review its photograph, variants and publication.</p></div>}
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{filtered.map(p=><Link key={p.id} to={p.catalogue_kind==='fabric'?'/swatch-library':'/crystal-components/'+p.id} className="card flex gap-3 p-3 hover:bg-ivory-dark focus-visible:ring-2 focus-visible:ring-brand-500"><div className="w-24 h-24 shrink-0 bg-white flex items-center justify-center overflow-hidden">{p.catalogue_kind==='fabric'?<SwatchPhoto path={p.image_path} alt="Crystal Fabric reference"/>:<CrystalProductPhoto product={p}/>}</div><div className="min-w-0 break-words space-y-1"><p className="text-xs text-ink-60">{p.catalogue_kind==='fabric'?'Published reference swatches':p.code+' · '+p.publication}</p><h2 className="text-sm">{p.name}</h2><p className="text-xs text-ink-60">{CRYSTAL_ORIGINS[p.origin]}</p><p className="text-xs text-ink-60">{p.catalogue_kind==='fabric'?'Manage existing swatches · project quotations':CRYSTAL_SUPPLY[p.supply]}</p></div></Link>)}</div>
 </div>
}
