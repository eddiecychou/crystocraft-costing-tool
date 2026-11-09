import {useState} from 'react'
import {saveCustomerWorkItem} from '../../domain/customerWorkItems'
export default function WorkbenchTasks({items,all,due,waiting,filter,onFilter,onOpen,onAdd,loading,error,today,scopeLabel='',onClearScope}) {
  const [busy,setBusy]=useState(''),[saveError,setSaveError]=useState('')
  async function complete(item){
    setBusy(`${item.customerId}:${item.id}`);setSaveError('')
    try{await saveCustomerWorkItem(item.customerId,item,{...item,state:'done'})}
    catch(e){setSaveError(e.message||'Could not complete this task. It remains open.')}
    finally{setBusy('')}
  }
  const task=item=><li key={`${item.customerId}:${item.source}:${item.id}`} className="px-4 py-3 flex gap-3 items-start">
    <button className="group mt-0.5 border border-ink-40 w-11 h-11 shrink-0 text-ink-60 hover:text-brand-600" aria-label={`Complete task: ${item.text}`} disabled={!!busy} onClick={()=>complete(item)}>{busy===`${item.customerId}:${item.id}`?'…':<span aria-hidden="true" className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">✓</span>}</button>
    <button onClick={()=>onOpen(item.customerId,{kind:'task',item})} className="text-left min-w-0 flex-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
      <span className="line-clamp-2 text-sm text-ink whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</span>
      <span className="block text-xs text-ink-60 mt-1 break-words">{item.customer.company_name||item.customer.contact_name||'Customer'} · {item.state==='waiting'?'Waiting · ':''}{item.due_on?`${item.due_on<today?'Overdue · ':item.due_on===today?'Today · ':''}${item.due_on}`:'No due date'}</span>
    </button>
  </li>
  return <section className="card" aria-label="My tasks">
    <div className="p-4 flex items-center justify-between gap-3"><h2 className="text-lg">My tasks <span className="text-ink-60 text-sm">{loading?'…':all.length}</span></h2><button className="btn-primary text-xs px-3 min-h-11" onClick={onAdd}>+ Add task</button></div>
    <div className="px-4 pb-3 flex flex-wrap gap-2" aria-label="Task filters">{[['all','All open',all],['due','Due',due],['waiting','Waiting',waiting]].map(([key,label,rows])=><button key={key} data-task-filter={key} data-count={rows.length} aria-pressed={filter===key} onClick={()=>onFilter(key)} className={`px-3 py-2 text-sm border ${filter===key?'bg-ink text-white border-ink':'border-warm-grey text-ink-70'}`}>{label} <span>{loading?'…':rows.length}</span></button>)}</div>
    {scopeLabel&&<p className="px-4 pb-2 text-xs text-ink-60 break-words">Filtered: {scopeLabel}. <button className="underline text-brand-600 min-h-11" onClick={onClearScope}>Show all B2B</button></p>}
    {(error||saveError)&&<p role="alert" className="px-4 pb-3 text-sm text-brand-600">{error||saveError}</p>}
    {loading?<p role="status" className="p-4 text-sm text-ink-60">Loading tasks…</p>:filter==='due'?<div aria-label="Follow-ups due">
      <h3 className="px-4 pb-3 text-sm text-ink-60">{due.filter(i=>i.due_on<today).length} overdue · {due.filter(i=>i.due_on===today).length} today</h3>
      {['Overdue','Today'].map(label=><section key={label} aria-label={`${label} tasks`}><h4 className="px-4 py-2 text-xs bg-ivory">{label}</h4><ul className="divide-y divide-warm-grey">{items.filter(i=>label==='Today'?i.due_on===today:i.due_on<today).map(task)}</ul></section>)}
    </div>:<ul className="divide-y divide-warm-grey" aria-label="Outstanding tasks">{items.map(task)}</ul>}
    {!loading&&!error&&!items.length&&<p className="px-4 py-5 text-sm text-ink-60">{filter==='all'?'No outstanding B2B tasks.':filter==='due'?'No tasks due today or overdue.':'No tasks waiting for a reply.'}</p>}
    {filter!=='all'&&<button className="m-4 text-sm text-brand-600 underline min-h-11" onClick={()=>onFilter('all')}>Show all open tasks</button>}
  </section>
}
