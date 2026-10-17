import { useState } from 'react'
import { Link } from 'react-router-dom'
import { emptyPipeline } from '../customerPipeline'
import { savePipelineDecision, suggestCustomerPipeline } from '../domain/customerPipeline'
import {summaryPeriodLabel} from '../customerSummary'

export function CustomerPipeline({ customer, showLink=false, save=savePipelineDecision }) {
  const p=customer.sales_pipeline || emptyPipeline(), proposal=p.suggestion
  const [editor,setEditor]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[history,setHistory]=useState(false)
  async function act(action,input) {
    setBusy(true);setError('')
    try {await save(customer.id,input.expectedRevision ?? p.revision,action,input,input.eventId);setEditor(null)}
    catch(e){setError(e.message || 'Could not save. Your draft is still here.')}
    finally{setBusy(false)}
  }
  return <section className="p-4 border-b border-warm-grey" aria-label={`Pipeline for ${customer.company_name || 'customer'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm">{showLink?<Link className="text-brand-600 hover:underline" to={`/customers/${customer.id}`}>{customer.company_name || 'Customer'}</Link>:'Customer Pipeline'} · {p.status==='active'?'Active':'Not active'}</h3>
      <div className="flex flex-wrap gap-2">
      <button className="btn-secondary text-xs min-h-[40px]" disabled={busy} onClick={()=>{setError('');setEditor({action:'manual',status:'active',detail:p.detail || '',expectedRevision:p.revision,eventId:crypto.randomUUID()})}}>{p.status==='active'?'Edit position':'Add to Pipeline'}</button>
        <button className="btn-secondary text-xs min-h-[40px]" disabled={busy} onClick={()=>{setError('');setEditor({action:'manual',status:'inactive',detail:'Transaction completed; no outstanding buying requests.',expectedRevision:p.revision,eventId:crypto.randomUUID(),transactionCompleted:true})}}>Transaction completed</button>
      </div>
    </div>
    {p.detail&&<p className="text-sm mt-2 whitespace-pre-wrap break-words">{p.detail}</p>}
    <p className="text-xs text-ink-60 mt-1">One customer, one position. Confirming an order does not close other buying requests.</p>
    {proposal&&<div className="mt-3 p-3 bg-ivory border border-warm-grey">
      <p className="label">AI suggestion · Awaiting your confirmation</p>
      <p className="text-xs text-ink-60 mt-1">Source: last {summaryPeriodLabel(proposal.source_cache==='customer_summary_14'?14:proposal.source_cache==='customer_summary_90'?90:30)}</p>
      <p className="text-sm mt-2">{proposal.status==='active'?(p.status==='active'?'Update active position':'Add to Pipeline'):'Close active position'}</p>
      <p className="text-sm whitespace-pre-wrap break-words mt-1">{proposal.detail}</p>
      <p className="text-xs text-ink-60 mt-2">{proposal.reason}</p>
      <blockquote className="text-xs text-ink-60 whitespace-pre-wrap break-words mt-2">From summary: “{proposal.evidence}”</blockquote>
      <div className="flex flex-wrap gap-2 mt-3">
        <button disabled={busy} className="btn-secondary text-xs min-h-[40px]" onClick={()=>{setError('');setEditor({action:'confirm',status:proposal.status,detail:proposal.detail,sourceKey:proposal.source_key,expectedRevision:p.revision,eventId:crypto.randomUUID()})}}>Review suggestion</button>
        <button disabled={busy} className="btn-secondary text-xs min-h-[40px]" onClick={()=>act('dismiss',{sourceKey:proposal.source_key})}>Dismiss suggestion</button>
      </div>
    </div>}
    {error&&<p role="alert" className="text-sm text-brand-600 mt-2">{error}</p>}
    {editor&&<form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();act(editor.action,editor)}}>
      {editor.transactionCompleted&&<p className="text-sm text-brand-600">Complete this customer’s Pipeline only if all buying requests are resolved. Keep the customer active if a separate sample, price, product or repeat-order request remains. This does not change any order, invoice, task or interaction history.</p>}
      <label className="block text-sm">Pipeline position
        <select className="input mt-1" value={editor.status} disabled={editor.action==='confirm'||editor.transactionCompleted||busy} onChange={e=>setEditor({...editor,status:e.target.value})}>
          <option value="active">Active buying request</option><option value="inactive">No active buying request — won, lost, cancelled or paused</option>
        </select>
      </label>
      <label className="block text-sm">{editor.status==='active'?'What is the customer requesting? Keep any other unresolved requests.':'Why should this customer leave the active Pipeline?'}
        <textarea className="input mt-1" rows={3} maxLength={2000} required value={editor.detail} onChange={e=>setEditor({...editor,detail:e.target.value})}/>
      </label>
      <p className="text-xs text-ink-60">Your tasks and notes stay in Customer Summary &amp; To-do.</p>
      <div className="flex gap-2"><button className="btn-primary text-xs min-h-[40px]" disabled={busy}>{busy?'Saving…':editor.status==='active'?'Confirm active customer':'Confirm closure'}</button><button type="button" className="btn-secondary text-xs min-h-[40px]" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button></div>
    </form>}
    {p.revision>0&&<button className="text-xs text-brand-600 underline min-h-[40px]" onClick={()=>setHistory(!history)}>{history?'Hide review record':'Show latest review record'}</button>}
    {history&&<p className="text-xs text-ink-60">Revision {p.revision} · {p.last_action} · {p.updatedAt?.toDate?.().toLocaleString('en-GB') || 'Saving…'}. All previous decisions remain in the internal Pipeline history.</p>}
  </section>
}

export default function PipelinePanel({ customers, allCustomers=customers, summaryPeriod=30, suggest=suggestCustomerPipeline }) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
  const pending=customers.filter(c=>c.sales_pipeline?.suggestion),active=customers.filter(c=>c.sales_pipeline?.status==='active')
  async function generate(){setBusy(true);setError('');setMessage('Reading shared summaries…');try{const count=await suggest(allCustomers,(n,total)=>setMessage(`Reviewed ${n} of ${total} summaries…`),summaryPeriod);setMessage(`${count} suggestion${count===1?'':'s'} prepared. Confirmed positions are unchanged.`)}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <div className="card mb-6" aria-label="Customer Pipeline">
    <div className="p-4 border-b border-warm-grey flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base">Customer Pipeline</h2><p className="text-xs text-ink-60 mt-1">{active.length} confirmed active customers · {pending.length} suggestions awaiting review. Product, sample, price and quotation requests.</p></div>
      <button className="btn-secondary text-xs min-h-[40px]" disabled={busy} onClick={generate}>{busy?'Preparing suggestions…':'Suggest from summaries'}</button>
      <p className="text-xs text-ink-60 w-full">Uses saved email and WhatsApp summaries for the last {summaryPeriodLabel(summaryPeriod)}. To update them, go back to Customer Summary & To-do and choose Update AI summaries. This button only prepares suggestions; it does not sync messages or regenerate summaries. Suggestions cover all customers; the current filters control this list.</p>
    </div>
    {message&&<p role="status" className="p-4 text-sm text-ink-60">{message}</p>}{error&&<p role="alert" className="p-4 text-sm text-brand-600">{error}</p>}
    {!!pending.length&&<h3 className="eyebrow px-4 pt-4">Awaiting your review</h3>}
    {pending.map(c=><CustomerPipeline key={c.id} customer={c} showLink/>)}
    {!!active.filter(c=>!c.sales_pipeline.suggestion).length&&<h3 className="eyebrow px-4 pt-4">Confirmed active customers</h3>}
    {active.filter(c=>!c.sales_pipeline.suggestion).map(c=><CustomerPipeline key={c.id} customer={c} showLink/>)}
    {!active.length&&!pending.length&&<p className="text-sm text-ink-60 p-4">No confirmed Pipeline customers in this view. Prepare suggestions, or open a customer to confirm an active buying request. Historical interaction statuses are not counted.</p>}
  </div>
}
