import {useState,useEffect,useMemo} from 'react'
import {collection,collectionGroup,query,onSnapshot,doc} from 'firebase/firestore'
import {Link} from 'react-router-dom'
import {db} from '../firebase'
import {normalizeCustomer} from '../domain/customer'
import {useCustomerWorkItems} from '../domain/customerWorkItems'
import {combineWorkItems} from '../customerWorkItems'
import {isDashboardB2B,groupCustomerItems,dashboardTasks,customerWorkRows,REVIEW_PERIODS,WORK_STAGES} from '../dashboardWorkbench'
import {fetchCustomerActivity} from '../customerActivityApi'
import WorkbenchTasks from '../components/dashboard/WorkbenchTasks'
import WorkbenchCustomerDialog from '../components/dashboard/WorkbenchCustomerDialog'
import PipelinePanel from '../components/CustomerPipeline'
import useOcToday from '../hooks/useOcToday'
import useSummaryPeriod from '../hooks/useSummaryPeriod'
import useSummaryUpdate from '../hooks/useSummaryUpdate'
import {SUMMARY_PERIODS,summaryCacheId,summaryPeriodLabel} from '../customerSummary'
import {formatOcDate,formatOcDateTime,inOcLast30Days} from '../ocTime'

const customerName=c=>c.company_name||c.contact_name||c.id
export default function Dashboard() {
  const [customers,setCustomers]=useState([]),[orders,setOrders]=useState([]),[quotes,setQuotes]=useState([]),[enquiries,setEnquiries]=useState([])
  const [loaded,setLoaded]=useState({}),[errors,setErrors]=useState({})
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[category,setCategory]=useState('')
  const [selection,setSelection]=useState(null),[reviewDays,setReviewDays]=useState(()=>{try{const v=Number(localStorage.getItem('oc:contact-review-days'));return REVIEW_PERIODS.includes(v)?v:30}catch{return 30}})
  const [activity,setActivity]=useState({customers:[],checkedAt:null,loading:true,error:''}),[refresh,setRefresh]=useState(0)
  const [summaryPeriod,setSummaryPeriod]=useSummaryPeriod(),[summary,setSummary]=useState(null),[summaryError,setSummaryError]=useState('')
  const update=useSummaryUpdate(),today=useOcToday()
  useEffect(()=>{
    const stops=[['customers',rows=>setCustomers(rows.map(c=>({...normalizeCustomer(c),id:c.id})))],['orders',setOrders],['client_quotes',setQuotes]].map(([name,set])=>onSnapshot(query(collection(db,name)),snap=>{
      set(snap.docs.map(d=>({...d.data(),id:d.id})));setLoaded(v=>({...v,[name]:true}));setErrors(v=>({...v,[name]:''}))
    },()=>{setErrors(v=>({...v,[name]:`${name==='client_quotes'?'Quotations':name==='orders'?'Orders':'Customers'} could not load. Reload or check access.`}));setLoaded(v=>({...v,[name]:true}))}))
    return()=>stops.forEach(stop=>stop())
  },[])
  useEffect(()=>onSnapshot(collectionGroup(db,'enquiries'),snap=>{
    setEnquiries(snap.docs.filter(d=>d.ref.parent.parent?.parent.id==='customers').map(d=>({...d.data(),id:d.id,customerId:d.ref.parent.parent.id})))
    setLoaded(v=>({...v,enquiries:true}));setErrors(v=>({...v,enquiries:''}))
  },()=>{setErrors(v=>({...v,enquiries:'Interaction follow-ups could not load. Reload or check access.'}));setLoaded(v=>({...v,enquiries:true}))}),[])
  useEffect(()=>{
    const controller=new AbortController();setActivity(v=>({...v,loading:true,error:''}))
    fetchCustomerActivity({signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setActivity({...data,loading:false,error:''})}).catch(e=>{if(!controller.signal.aborted)setActivity({customers:[],checkedAt:null,loading:false,error:e.message})})
    return()=>controller.abort()
  },[refresh])
  useEffect(()=>{setSummary(null);setSummaryError('');return onSnapshot(doc(db,'dashboard_cache',summaryCacheId(summaryPeriod)),snap=>setSummary(snap.exists()?snap.data():null),()=>setSummaryError('Saved summaries could not load. Reload or check access.'))},[summaryPeriod])
  const b2b=useMemo(()=>customers.filter(isDashboardB2B).sort((a,b)=>customerName(a).localeCompare(customerName(b))),[customers])
  const work=useCustomerWorkItems(b2b.map(c=>c.id))
  const grouped=useMemo(()=>groupCustomerItems(b2b,enquiries,work.items,combineWorkItems),[b2b,enquiries,work.items])
  const scoped=b2b.filter(c=>(!category||c.crm_category===category)&&(!search||`${customerName(c)} ${c.contact_name||''}`.toLowerCase().includes(search.toLowerCase())))
  const all=dashboardTasks(scoped,grouped,today),due=dashboardTasks(scoped,grouped,today,'due'),waiting=dashboardTasks(scoped,grouped,today,'waiting')
  const rows=customerWorkRows({customers:scoped,grouped,quotes,orders,activity:activity.customers,days:reviewDays})
  const everyRow=customerWorkRows({customers:b2b,grouped,quotes,orders,activity:activity.customers,days:36500})
  const ids=new Set(scoped.map(c=>c.id)),b2bOrders=orders.filter(o=>ids.has(o.customer_id))
  const activeOrders=b2bOrders.filter(o=>['confirmed','packing','ready'].includes(o.status)),newOrders=b2bOrders.filter(o=>inOcLast30Days(o.order_date))
  const tasksLoading=!loaded.customers||!loaded.enquiries||work.loading
  function open(customerId,editor=null){setSelection({customerId,editor})}
  function review(value){setReviewDays(value);try{localStorage.setItem('oc:contact-review-days',String(value))}catch{ /* Private browsing still supports this session. */ }}
  const summaryTools=<div className="space-y-3">
    <label className="block text-sm">Summary context<select className="input mt-1 max-w-xs" value={summaryPeriod} disabled={update.running} onChange={e=>setSummaryPeriod(e.target.value)}>{SUMMARY_PERIODS.map(p=><option key={p.days} value={p.days}>{p.label}</option>)}</select></label>
    <button className="btn-secondary text-xs" disabled={update.running} onClick={()=>update.start(summaryPeriod)}>{update.running?'Updating AI summaries…':'Update AI summaries'}</button>
    {summary?.generatedAt&&<p className="text-xs text-ink-60">Updated {formatOcDateTime(summary.generatedAt?.toDate?.())}</p>}
    <p className="text-xs text-ink-60">Uses synced conversations for the last {summaryPeriodLabel(summaryPeriod)}. Contact review and tasks are separate; changing either period does not run AI.</p>
    {(summaryError||update.error)&&<p role="alert" className="text-sm text-brand-600">{summaryError||update.error}</p>}
  </div>
  return <div className="p-4 md:p-6 max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-xl md:text-2xl">Dashboard</h1><p className="text-xs text-ink-60 mt-1">B2B customer work · {formatOcDate(new Date())} · Hong Kong time</p></div><Link className="text-sm text-brand-600 underline min-h-11 py-2" to="/marketing?tab=drafts&contact=quiet90">Daily Drafts · quiet 3 months →</Link></header>
    {update.running&&<p role="status" className="text-sm text-ink-60">Updating AI summaries · Last {summaryPeriodLabel(update.days)}. {update.progress}</p>}
    <WorkbenchTasks scopeLabel={[category,search].filter(Boolean).join(' · ')} onClearScope={()=>{setCategory('');setSearch('')}} items={filter==='due'?due:filter==='waiting'?waiting:all} all={all} due={due} waiting={waiting} filter={filter} onFilter={setFilter} today={today} loading={tasksLoading} error={errors.customers||errors.enquiries||work.error} onOpen={open} onAdd={()=>open('',{kind:'task'})}/>
    <section className="card" aria-label="Customers I’m dealing with">
      <div className="p-4 border-b border-warm-grey flex flex-wrap justify-between gap-3 items-center"><div><h2 className="text-lg">Customers I’m dealing with</h2><p className="text-xs text-ink-60 mt-1">Ongoing work stays visible beyond the contact review period.</p></div><label className="text-xs text-ink-60">Contact review<select className="input mt-1 py-2" value={reviewDays} onChange={e=>review(Number(e.target.value))}>{REVIEW_PERIODS.map(d=><option key={d} value={d}>{d===365?'1 year':`${d/30} month${d===30?'':'s'}`}</option>)}</select></label></div>
      <div className="p-4 flex flex-wrap gap-3 items-end"><label className="text-xs text-ink-60 flex-1 min-w-0">Find B2B customer<input type="search" className="input mt-1" placeholder="Company or contact" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="text-xs text-ink-60">Category<select className="input mt-1" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All B2B</option>{['Distributor','Small B2B','Gift / OEM','Crystal Fabric'].map(c=><option key={c}>{c}</option>)}</select></label><button className="text-sm text-brand-600 underline min-h-11" onClick={()=>open('')}>Browse all B2B</button></div>
      {(search||category)&&<p className="px-4 pb-3 text-xs text-ink-60">Task counts and customer rows are filtered. <button className="underline text-brand-600 min-h-11" onClick={()=>{setSearch('');setCategory('')}}>Clear filters</button></p>}
      {Object.values(errors).filter(Boolean).map(message=><p role="alert" key={message} className="px-4 pb-2 text-sm text-brand-600">{message}</p>)}
      {activity.error&&<p role="alert" className="px-4 pb-3 text-sm text-brand-600">{activity.error} Current tasks and saved work remain visible. <button className="underline min-h-11" onClick={()=>setRefresh(n=>n+1)}>Retry contact history</button></p>}
      {activity.loading&&<p role="status" className="px-4 pb-3 text-xs text-ink-60">Loading recorded contact dates…</p>}
      <ul className="divide-y divide-warm-grey" aria-label="Customer work overview">{rows.map(row=><li key={row.customer.id}><button className="w-full text-left p-4 flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-ivory min-w-0" onClick={()=>open(row.customer.id)}>
        <span className="flex-1 min-w-[120px] break-words text-sm font-medium">{customerName(row.customer)}</span>
        <span className="flex flex-wrap gap-1.5 sm:flex-1">{row.stages.length?row.stages.map(stage=><span key={stage} className="text-xs bg-ivory px-2 py-1 border border-warm-grey">{WORK_STAGES[stage]}</span>):<span className="text-xs text-ink-60">{row.active?'Stage not set':'Recent contact'}</span>}</span>
        <span className="text-xs text-ink-60">{row.lastContact?`Contact: ${formatOcDate(new Date(row.lastContact))}`:'Contact date unknown'}{row.historyState==='partial'?' · Partial history':''}{row.active&&!row.recent?' · Ongoing work':''}</span>
        <span className="text-xs text-ink-60">{row.tasks.length} open {row.tasks.length===1?'task':'tasks'} →</span>
      </button></li>)}</ul>
      {!tasksLoading&&!rows.length&&<p className="p-4 text-sm text-ink-60">No current work or recorded contacts in this view. Browse all B2B to review a customer.</p>}
      <div className="px-4 py-3 border-t border-warm-grey flex flex-wrap justify-between gap-2 text-xs text-ink-60"><span>{activity.checkedAt?`Contact dates checked ${formatOcDateTime(new Date(activity.checkedAt))}`:'No contact-date snapshot loaded'}</span><button className="underline min-h-11" disabled={activity.loading} onClick={()=>setRefresh(n=>n+1)}>Refresh contact dates</button></div>
    </section>
    <div className="flex flex-wrap gap-4 text-sm text-ink-60"><Link className="text-brand-600 underline min-h-11 py-2" to="/shipping">Order &amp; Production · {loaded.orders?activeOrders.length:'…'}</Link><Link className="text-brand-600 underline min-h-11 py-2" to="/shipping">New orders · {loaded.orders?newOrders.length:'…'} in 30 days</Link></div>
    <details className="card"><summary className="p-4 text-sm cursor-pointer">Summary and work review tools</summary><div className="p-4">{summaryTools}</div><PipelinePanel customers={scoped} allCustomers={b2b} summaryPeriod={summaryPeriod}/><details className="p-4"><summary className="text-sm cursor-pointer">Personal WhatsApp contacts</summary>{scoped.filter(c=>c.is_personal_wa).map(c=><button key={c.id} onClick={()=>open(c.id)} className="block py-3 text-sm text-brand-600 underline">{customerName(c)}</button>)}</details></details>
    {selection&&<WorkbenchCustomerDialog key={selection.customerId||'choose'} customers={b2b} selection={selection} onSelect={id=>open(id,selection.editor)} onClose={()=>setSelection(null)} items={grouped.get(selection.customerId)||[]} row={everyRow.find(r=>r.customer.id===selection.customerId)} digest={summary?.items?.find(i=>i.customerId===selection.customerId)} summaryDays={summaryPeriod} summaryTools={summaryTools}/>}
  </div>
}
