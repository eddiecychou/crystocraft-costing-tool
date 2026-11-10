import {useEffect,useId,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {X} from 'lucide-react'
import CustomerWorkspace,{SummaryText} from '../CustomerWorkspace'
import {CustomerPipeline} from '../CustomerPipeline'
import {WORK_STAGES,WORK_STAGE_DESCRIPTIONS} from '../../dashboardWorkbench'
import WorkStageBadge from './WorkStageBadge'
import {saveCustomerWorkStages} from '../../domain/customerWorkStages'
import {orderUc,orderStatusOf} from '../../shippingModel'
import {formatOcDate} from '../../ocTime'

function WorkStages({customer,row}) {
  const [editor,setEditor]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const id=useId(),stages=row?.stages||customer.dashboard_work?.stages||[]
  async function save(e){e.preventDefault();setBusy(true);setError('');try{await saveCustomerWorkStages(customer.id,editor.revision,editor.stages,editor.id);setEditor(null)}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <section className="p-4 border-b border-warm-grey" aria-label="Work stages">
    <div className="flex flex-wrap justify-between gap-2 items-center"><h3 className="text-sm">Work stages</h3><button className="btn-secondary text-xs min-h-11" disabled={!!editor} onClick={()=>setEditor({revision:customer.dashboard_work?.revision||0,stages:customer.dashboard_work?.stages||[],id:crypto.randomUUID()})}>Set work stages</button></div>
    {stages.length>0&&<div className="mt-2 flex flex-wrap gap-2">{stages.map(stage=><WorkStageBadge key={stage} stage={stage}/>)}</div>}
    <p className="text-xs text-ink-60 mt-2">Choose Exploration for ongoing discussions before a quotation or PI. Recent communication alone does not set it.</p>
    {error&&<p role="alert" className="text-sm text-brand-600 mt-2">{error}</p>}
    {editor&&<form onSubmit={save} aria-busy={busy} className="mt-3 space-y-3">
      <fieldset><legend className="text-sm mb-2">Select current work; more than one is allowed for separate projects</legend>{Object.entries(WORK_STAGES).map(([key,label])=><label key={key} className="flex min-h-11 items-start gap-3 py-2 text-sm"><input className="mt-1 shrink-0" type="checkbox" aria-label={label} aria-describedby={`${id}-${key}`} checked={editor.stages.includes(key)} onChange={e=>setEditor({...editor,stages:e.target.checked?[...editor.stages,key]:editor.stages.filter(s=>s!==key)})}/><span className="min-w-0"><WorkStageBadge stage={key}/><span id={`${id}-${key}`} className="mt-1 block text-xs text-ink-60">{WORK_STAGE_DESCRIPTIONS[key]}</span></span></label>)}</fieldset>
      <p className="text-xs text-ink-60">Clear Exploration when that discussion moves to quotation or order. Keep it for other early projects. Saved open quotes and orders supply their own badges; clearing a manual stage does not close them or any tasks.</p>
      <div className="flex gap-2"><button className="btn-primary min-h-11 text-xs" disabled={busy}>{busy?'Saving…':'Save stages'}</button><button type="button" className="btn-secondary min-h-11 text-xs" disabled={busy} onClick={()=>{setEditor(null);setError('')}}>Cancel</button></div>
    </form>}
  </section>
}
export default function WorkbenchCustomerDialog({customers,selection,onSelect,onClose,items,row,digest,summaryDays,summaryTools}) {
  const ref=useRef(null),[confirmClose,setConfirmClose]=useState(false)
  const customer=customers.find(c=>c.id===selection.customerId)
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close()},[])
  function close(){if(ref.current.querySelector('form[aria-busy="true"]'))return;if(ref.current.querySelector('form')){setConfirmClose(true);ref.current.scrollTo?.({top:0,behavior:'auto'})}else onClose()}
  return <dialog ref={ref} aria-label={customer?`Customer work: ${customer.company_name||customer.contact_name}`:'Add task'} onCancel={e=>{e.preventDefault();close()}} className="dashboard-customer-dialog card p-0 text-ink backdrop:bg-ink/60">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-warm-grey bg-white p-4"><div className="min-w-0"><h2 className="min-w-0 break-words text-base md:text-lg">{customer?.company_name||customer?.contact_name||'Add a B2B task'}</h2>{customer&&<Link onClick={e=>{if(ref.current.querySelector('form')){e.preventDefault();close()}}} className="text-xs text-brand-600 underline inline-block py-2" to={`/customers/${customer.id}`}>Open full customer record →</Link>}</div><button className="btn-ghost h-11 w-11 shrink-0 p-0" aria-label="Close customer details" onClick={close}><X size={20}/></button></header>
    {confirmClose&&<div role="alert" className="p-4 bg-ivory border-b border-warm-grey"><p className="text-sm">An editor is still open. Keep editing to preserve its unsaved draft.</p><div className="flex flex-wrap gap-2 mt-3"><button className="btn-primary text-xs" onClick={()=>setConfirmClose(false)}>Keep editing</button><button className="btn-secondary text-xs" onClick={onClose}>Discard draft and close</button></div></div>}
    {!customer?<label className="block p-4 text-sm">Customer<select autoFocus className="input mt-2" value="" onChange={e=>onSelect(e.target.value)}><option value="">Choose customer…</option>{customers.map(c=><option value={c.id} key={c.id}>{c.company_name||c.contact_name||c.id}</option>)}</select></label>:<>
      {customer.customer_type==='b2b'&&customer.tags?.includes('Retail Customer')&&<p className="p-4 text-xs text-ink-60">Classified B2B with a legacy retail tag. Included as B2B; review the classification on the customer record if needed.</p>}{customer.is_personal_wa&&<p className="p-4 bg-ivory text-sm">Uses personal WhatsApp — check your phone for conversations that have not been recorded in OC.</p>}
      <CustomerWorkspace customerId={customer.id} customerName={customer.company_name||customer.contact_name} items={items} initialEditor={selection.editor} showSummary={false} notesCollapsed protectDraft/>
      <WorkStages customer={customer} row={row}/>
      <details className="border-b border-warm-grey"><summary className="p-4 cursor-pointer text-sm">Email &amp; conversation summary</summary><div className="px-4 pb-4">{summaryTools}<p className="text-xs text-ink-60 mt-3">Saved AI context · {summaryDays} days</p><SummaryText key={`${summaryDays}:${digest?.digest||''}`} digest={digest?.digest||'No saved summary for this period. Tasks remain available.'}/>{digest?.sourceLimited&&<p className="text-xs text-ink-60 mt-2">Selected excerpts only. Check the full customer history.</p>}</div></details>
      <details className="border-b border-warm-grey"><summary className="p-4 cursor-pointer text-sm">Current work and linked records</summary>
        <div className="p-4 space-y-2 text-sm">{row?.quotes.map(q=><Link key={q.id} to={`/quotes/${q.id}`} className="block text-brand-600 underline">Quotation · {q.quote_number||q.quote_no||q.id} · {q.status}</Link>)}{row?.orders.map(o=><Link key={o.id} to={`/shipments/${o.id}`} className="block text-brand-600 underline">{orderUc(o)||o.id} · {orderStatusOf(o.status).label}</Link>)}</div>
        <CustomerPipeline customer={customer} workbench/>
      </details>
      <p className="p-4 text-xs text-ink-60">Last recorded contact: {row?.lastContact?formatOcDate(new Date(row.lastContact)): 'Unknown'}{row?.historyState==='partial'?' · Some history dates need review.':''}. Tasks, notes and summary updates do not change this date.</p>
    </>}
  </dialog>
}
