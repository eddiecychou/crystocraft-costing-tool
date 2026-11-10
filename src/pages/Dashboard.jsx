import {useState,useEffect,useMemo} from 'react'
import {collection,collectionGroup,query,onSnapshot,doc} from 'firebase/firestore'
import {Link} from 'react-router-dom'
import {ChevronRight} from 'lucide-react'
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
  return <div className="dashboard-workbench max-w-7xl space-y-4 p-4 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-xl md:text-2xl">Dashboard</h1><p className="text-xs text-ink-60 mt-1">B2B customer work · {formatOcDate(new Date())} · Hong Kong time</p></div><Link className="text-sm text-brand-600 underline min-h-11 py-2" to="/marketing?tab=drafts&contact=quiet90">Daily Drafts · quiet 3 months →</Link></header>
    {update.running&&<p role="status" className="text-sm text-ink-60">Updating AI summaries · Last {summaryPeriodLabel(update.days)}. {update.progress}</p>}
    <WorkbenchTasks scopeLabel={[category,search].filter(Boolean).join(' · ')} onClearScope={()=>{setCategory('');setSearch('')}} items={filter==='due'?due:filter==='waiting'?waiting:all} all={all} due={due} waiting={waiting} filter={filter} onFilter={setFilter} today={today} loading={tasksLoading} error={errors.customers||errors.enquiries||work.error} onOpen={open} onAdd={()=>open('',{kind:'task'})}/>
    <section className="card" aria-label="Customers I’m dealing with">
      <div className="dashboard-customer-header grid items-center gap-4 border-b border-warm-grey p-4">
        <div><h2 className="text-base md:text-lg">Customer work</h2><p className="mt-1 text-xs text-ink-60">Ongoing work stays visible.</p></div>
        <div className="w-36 sm:w-40"><label className="label" htmlFor="dashboard-contact-review">Contact review</label>
          <select id="dashboard-contact-review" className="input" value={reviewDays} onChange={e=>review(Number(e.target.value))}>{REVIEW_PERIODS.map(d=><option key={d} value={d}>{d===365?'1 year':`${d/30} month${d===30?'':'s'}`}</option>)}</select>
        </div>
      </div>
      <div className="dashboard-customer-filters grid items-end gap-3 p-4">
        <div className="col-span-2 min-w-0 lg:col-span-1"><label className="label" htmlFor="dashboard-customer-search">Find B2B customer</label><input id="dashboard-customer-search" type="search" className="input" placeholder="Company or contact" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="min-w-0"><label className="label" htmlFor="dashboard-customer-category">Category</label><select id="dashboard-customer-category" className="input" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All B2B</option>{['Distributor','Small B2B','Gift / OEM','Crystal Fabric'].map(c=><option key={c}>{c}</option>)}</select></div>
        <button aria-label="Browse all B2B" className="btn-secondary min-h-11 px-3 text-xs sm:min-h-0" onClick={()=>open('')}><span className="sm:hidden">Browse</span><span className="hidden sm:inline">Browse all B2B</span></button>
      </div>
      {(search||category)&&<p className="px-4 pb-3 text-xs text-ink-60">Task counts and customer rows are filtered. <button className="underline text-brand-600 min-h-11" onClick={()=>{setSearch('');setCategory('')}}>Clear filters</button></p>}
      {Object.values(errors).filter(Boolean).map(message=><p role="alert" key={message} className="px-4 pb-2 text-sm text-brand-600">{message}</p>)}
      {activity.error&&<p role="alert" className="px-4 pb-3 text-sm text-brand-600">{activity.error} Current tasks and saved work remain visible. <button className="underline min-h-11" onClick={()=>setRefresh(n=>n+1)}>Retry contact history</button></p>}
      {activity.loading&&<p role="status" className="px-4 pb-3 text-xs text-ink-60">Loading recorded contact dates…</p>}
      <ul className="divide-y divide-warm-grey" aria-label="Customer work overview">{rows.map(row=><li key={row.customer.id}>
        <button className="dashboard-customer-row grid w-full items-start gap-x-3 gap-y-2 p-4 text-left hover:bg-ivory focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600" onClick={()=>open(row.customer.id)}>
          <span className="dashboard-customer-name min-w-0 break-words text-sm text-ink">{customerName(row.customer)}</span>
          <span className="dashboard-work-stages flex min-w-0 flex-wrap gap-2">{row.stages.length?row.stages.map(stage=><span key={stage} className="badge border border-warm-grey bg-ivory text-ink-70">{WORK_STAGES[stage]}</span>):<span className="text-xs text-ink-60">{row.active?'Stage not set':'Recent contact'}</span>}</span>
          <span className="dashboard-contact-date min-w-0 break-words text-xs text-ink-60">{row.lastContact?`Contact: ${formatOcDate(new Date(row.lastContact))}`:'Contact date unknown'}{row.historyState==='partial'?' · Partial history':''}{row.active&&!row.recent?' · Ongoing work':''}</span>
          <span className="dashboard-task-count flex shrink-0 lg:w-24 items-center justify-end gap-1 whitespace-nowrap text-xs text-ink-60"><span>{row.tasks.length} open {row.tasks.length===1?'task':'tasks'}</span><ChevronRight size={14} aria-hidden="true"/></span>
        </button>
      </li>)}</ul>
      {!tasksLoading&&!rows.length&&<p className="p-4 text-sm text-ink-60">No current work or recorded contacts in this view. Browse all B2B to review a customer.</p>}
      <div className="px-4 py-3 border-t border-warm-grey flex flex-wrap justify-between gap-2 text-xs text-ink-60"><span>{activity.checkedAt?`Contact dates checked ${formatOcDateTime(new Date(activity.checkedAt))}`:'No contact-date snapshot loaded'}</span><button className="underline min-h-11" disabled={activity.loading} onClick={()=>setRefresh(n=>n+1)}>Refresh contact dates</button></div>
    </section>
    <div className="flex flex-wrap gap-4 text-sm text-ink-60"><Link className="text-brand-600 underline min-h-11 py-2" to="/shipping">Order &amp; Production · {loaded.orders?activeOrders.length:'…'}</Link><Link className="text-brand-600 underline min-h-11 py-2" to="/shipping">New orders · {loaded.orders?newOrders.length:'…'} in 30 days</Link></div>
    <details className="card"><summary className="p-4 text-sm cursor-pointer">Summary and work review tools</summary><div className="p-4">{summaryTools}</div><PipelinePanel customers={scoped} allCustomers={b2b} summaryPeriod={summaryPeriod}/><details className="p-4"><summary className="text-sm cursor-pointer">Personal WhatsApp contacts</summary>{scoped.filter(c=>c.is_personal_wa).map(c=><button key={c.id} onClick={()=>open(c.id)} className="block py-3 text-sm text-brand-600 underline">{customerName(c)}</button>)}</details></details>
    {selection&&<WorkbenchCustomerDialog key={selection.customerId||'choose'} customers={b2b} selection={selection} onSelect={id=>open(id,selection.editor)} onClose={()=>setSelection(null)} items={grouped.get(selection.customerId)||[]} row={everyRow.find(r=>r.customer.id===selection.customerId)} digest={summary?.items?.find(i=>i.customerId===selection.customerId)} summaryDays={summaryPeriod} summaryTools={summaryTools}/>}
  </div>
}
