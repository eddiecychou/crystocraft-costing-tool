import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { saveCustomerWorkItem } from '../domain/customerWorkItems'
import { dateOnly } from '../customerWorkItems'

const LABEL = { todo: 'To do', waiting: 'Waiting', done: 'Done' }
export default function CustomerWorkspace({ customerId, customerName, digest, items = [], generatedAt, showLink = false, showSummary = true, saveItem = saveCustomerWorkItem }) {
  const uid = useId()
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showDone, setShowDone] = useState(false)
  const today = dateOnly(new Date())
  const completed = items.filter(i => i.state === 'done')
  const visible = items.filter(i => showDone || i.state !== 'done')
  function open(kind, item = null) {
    setError('')
    setEditor({ original: item, createId: crypto.randomUUID(), kind, text: item?.text || '', due_on: item?.due_on || '', state: item?.state || 'todo' })
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { await saveItem(customerId, editor.original, editor, editor.createId); setEditor(null) }
    catch (err) { setError(err.message || 'Could not save. Your draft is still here.') }
    finally { setBusy(false) }
  }
  async function changeState(item, state) {
    setBusy(true); setError('')
    try { await saveItem(customerId, item, { ...item, state }) }
    catch (err) { setError(err.message || 'Could not update this item.') }
    finally { setBusy(false) }
  }
  return <section className="p-4 border-b border-warm-grey last:border-b-0" aria-label={`Summary and to-do for ${customerName}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      {showLink ? <Link className="text-brand-600 hover:underline break-words min-w-0" to={`/customers/${customerId}`}>{customerName}</Link> : <h2 className="text-base">Customer Summary &amp; To-do</h2>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-xs min-h-[40px] px-3" onClick={() => open('task')}>Add task</button>
        <button className="btn-secondary text-xs min-h-[40px] px-3" onClick={() => open('note')}>Add note</button>
      </div>
    </div>
    {showSummary && <p className="text-sm text-ink-70 mt-2 whitespace-pre-wrap break-words">{digest || 'No recent summary. You can still add tasks and notes.'}</p>}
    {showSummary && digest && <p className="text-xs text-ink-60 mt-1">AI draft · Last 30 days{generatedAt ? ` · Updated ${generatedAt}` : ''} · Tasks and notes are saved separately.</p>}
    {error && <p role="alert" className="text-sm text-brand-600 mt-2">{error}</p>}
    {editor && <form onSubmit={save} className="mt-3 p-3 bg-ivory border border-warm-grey space-y-3">
      <label className="block text-sm" htmlFor={`${uid}-text`}>{editor.kind === 'note' ? 'Reference note' : 'Task'}
        <textarea id={`${uid}-text`} className="input mt-1" rows={3} maxLength={4000} required value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })} />
      </label>
      {editor.kind === 'task' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm" htmlFor={`${uid}-due`}>Due date (optional)<input id={`${uid}-due`} className="input mt-1" type="date" value={editor.due_on} onChange={e => setEditor({ ...editor, due_on: e.target.value })} /></label>
        <label className="text-sm" htmlFor={`${uid}-state`}>Status<select id={`${uid}-state`} className="input mt-1" value={editor.state} onChange={e => setEditor({ ...editor, state: e.target.value })}>{Object.entries(LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>}
      <div className="flex flex-wrap gap-2"><button disabled={busy} className="btn-primary text-xs">{busy ? 'Saving…' : 'Save'}</button><button type="button" disabled={busy} className="btn-secondary text-xs" onClick={() => {setEditor(null); setError('')}}>Cancel</button></div>
    </form>}
    <ul className="mt-3 divide-y divide-warm-grey">{visible.map(item => <li key={`${item.source}:${item.id}`} className="py-3 flex flex-wrap sm:flex-nowrap gap-3 items-start">
      <div className="flex-1 min-w-0"><p className={`text-sm whitespace-pre-wrap break-words ${item.state === 'done' ? 'text-ink-60 line-through' : 'text-ink'}`}>{item.text}</p>
        <p className="text-xs text-ink-60 mt-1">{item.kind === 'note' ? 'Reference note' : LABEL[item.state]}{item.due_on && ` · ${item.due_on < today && item.state !== 'done' ? 'Overdue · ' : item.due_on === today ? 'Today · ' : ''}${item.due_on}`}{item.source === 'interaction' && ' · From interaction history'}</p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0"><button disabled={busy} className="btn-secondary text-xs px-3 min-h-[40px]" onClick={() => open(item.kind, item)}>Edit</button>
        <button disabled={busy} className="btn-secondary text-xs px-3 min-h-[40px]" onClick={() => changeState(item, item.state === 'done' ? 'todo' : 'done')}>{item.state === 'done' ? 'Reopen' : item.kind === 'note' ? 'Archive' : 'Done'}</button>
      </div>
    </li>)}</ul>
    {!visible.length && <p className="text-sm text-ink-60 mt-2">No outstanding tasks or notes.</p>}
    {!!completed.length && <button className="text-xs text-brand-600 underline min-h-[40px]" onClick={() => setShowDone(v => !v)}>{showDone ? 'Hide completed' : `Show completed / archived (${completed.length})`}</button>}
  </section>
}
