import {useState} from 'react'
import {Check, Loader2, Plus} from 'lucide-react'
import {saveCustomerWorkItem} from '../../domain/customerWorkItems'

export default function WorkbenchTasks({items,all,due,waiting,filter,onFilter,onOpen,onAdd,loading,error,today,scopeLabel='',onClearScope}) {
  const [busy,setBusy]=useState(''),[saveError,setSaveError]=useState('')
  async function complete(item){
    setBusy(`${item.customerId}:${item.id}`);setSaveError('')
    try{await saveCustomerWorkItem(item.customerId,item,{...item,state:'done'})}
    catch(e){setSaveError(e.message||'Could not complete this task. It remains open.')}
    finally{setBusy('')}
  }
  const task=item=><li key={`${item.customerId}:${item.source}:${item.id}`} className="flex items-start gap-2 px-4 py-3">
    <button type="button" className="group -ml-3 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-wait"
      aria-label={`Complete task: ${item.text}`} aria-busy={busy===`${item.customerId}:${item.id}`} disabled={!!busy} onClick={()=>complete(item)}>
      <span className="task-complete-mark flex h-5 w-5 items-center justify-center border border-ink-40 text-brand-600 group-hover:border-brand-600 group-focus-visible:border-brand-600" aria-hidden="true">
        {busy===`${item.customerId}:${item.id}`?<Loader2 size={14} className="animate-spin"/>:<Check size={14} strokeWidth={2} className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"/>}
      </span>
    </button>
    <button type="button" onClick={()=>onOpen(item.customerId,{kind:'task',item})}
      className="min-h-11 min-w-0 flex-1 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
      <span className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-ink">{item.text}</span>
      <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-ink-60">
        <span className="min-w-0 break-words">{item.customer.company_name||item.customer.contact_name||'Customer'}</span>
        <span className={`whitespace-nowrap ${item.due_on&&item.due_on<today?'text-brand-600':''}`}>
          {item.state==='waiting'?'Waiting · ':''}{item.due_on?<>{item.due_on<today?'Overdue · ':item.due_on===today?'Today · ':''}<time dateTime={item.due_on}>{item.due_on}</time></>:'No due date'}
        </span>
      </span>
    </button>
  </li>
  return <section className="card" aria-label="My tasks">
    <div className="flex items-center justify-between gap-4 p-4">
      <h2 className="text-base md:text-lg">My tasks <span className="ml-1 text-sm text-ink-60">{loading?'…':all.length}</span></h2>
      <button type="button" className="btn-primary min-h-11 px-3 text-xs" onClick={onAdd}><Plus size={14} aria-hidden="true"/>Add task</button>
    </div>
    <div className="flex flex-wrap gap-2 px-4 pb-4" aria-label="Task filters">
      {[['all','All open',all],['due','Due',due],['waiting','Waiting',waiting]].map(([key,label,rows])=><button type="button" key={key} data-task-filter={key} data-count={rows.length} aria-pressed={filter===key} onClick={()=>onFilter(key)}
        className={`${filter===key?'tag-active':'tag-clickable'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`}>{label} <span className="tabular-nums">{loading?'…':rows.length}</span></button>)}
    </div>
    {scopeLabel&&<p className="break-words px-4 pb-2 text-xs text-ink-60">Filtered: {scopeLabel}. <button className="min-h-11 text-brand-600 underline" onClick={onClearScope}>Show all B2B</button></p>}
    {(error||saveError)&&<p role="alert" className="px-4 pb-3 text-sm text-brand-600">{error||saveError}</p>}
    {loading?<p role="status" className="p-4 text-sm text-ink-60">Loading tasks…</p>:filter==='due'?<div aria-label="Follow-ups due">
      <h3 className="px-4 pb-3 text-sm text-ink-60">{due.filter(i=>i.due_on<today).length} overdue · {due.filter(i=>i.due_on===today).length} today</h3>
      {['Overdue','Today'].map(label=><section key={label} aria-label={`${label} tasks`}>
        <h4 className="eyebrow bg-ivory px-4 py-2">{label}</h4>
        <ul className="divide-y divide-warm-grey">{items.filter(i=>label==='Today'?i.due_on===today:i.due_on<today).map(task)}</ul>
      </section>)}
    </div>:<ul className="divide-y divide-warm-grey" aria-label="Outstanding tasks">{items.map(task)}</ul>}
    {!loading&&!error&&!items.length&&<p className="px-4 py-5 text-sm text-ink-60">{filter==='all'?'No outstanding B2B tasks.':filter==='due'?'No tasks due today or overdue.':'No tasks waiting for a reply.'}</p>}
    {filter!=='all'&&<button className="m-4 min-h-11 text-sm text-brand-600 underline" onClick={()=>onFilter('all')}>Show all open tasks</button>}
  </section>
}
