import { useId, useState, useRef, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { saveCustomerWorkItem } from '../domain/customerWorkItems'
import { sortWorkItems } from '../customerWorkItems'
import useOcToday from '../hooks/useOcToday'
import {summaryPeriodLabel} from '../customerSummary'

export function SummaryText({ digest = '', collapse = true, previewLength = 500, expandLabel = 'Show more', className = 'text-sm text-ink-70 mt-2 whitespace-pre-wrap break-words' }) {
  const [expanded, setExpanded] = useState(false)
  const paragraph = useRef(null)
  const restorePreview = useRef(false)
  const id = useId()
  useLayoutEffect(() => {
    if (!expanded && restorePreview.current) {
      restorePreview.current = false
      paragraph.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
    }
  }, [expanded])
  const text = typeof digest === 'string' ? digest : ''
  const characters = Array.from(text)
  const long = collapse && characters.length > previewLength
  const prefix = characters.slice(0, previewLength).join('')
  const boundary = prefix.search(/\s+\S*$/u)
  const preview = boundary > previewLength * 0.7 ? prefix.slice(0, boundary) : prefix
  return <>
    <p ref={paragraph} id={id} className={`${className} min-w-0 [overflow-wrap:anywhere]`}>{long && !expanded ? `${preview.trimEnd()}…` : text}</p>
    {long && <button type="button" aria-expanded={expanded} aria-controls={id}
      className="text-sm text-brand-600 underline min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      onClick={() => { restorePreview.current = expanded; setExpanded(value => !value) }}>{expanded ? 'Show less' : expandLabel}</button>}
  </>
}

const LABEL = { todo: 'To do', waiting: 'Waiting', done: 'Done' }
export default function CustomerWorkspace({ customerId, customerName, digest, items = [], generatedAt, showLink = false, showSummary = true, collapseSummary = false, summaryPreviewLength = 500, summaryDays=30, sourceLimited=false, saveItem = saveCustomerWorkItem }) {
  const uid = useId()
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showDone, setShowDone] = useState(false)
  const today = useOcToday()
  const completed = items.filter(i => i.state === 'done')
  const visible = sortWorkItems(items.filter(i => showDone || i.state !== 'done'), today)
  const tasks = visible.filter(i => i.kind === 'task')
  const notes = visible.filter(i => i.kind === 'note')
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
  const editorForm = editor && (<form onSubmit={save} className="mt-3 p-3 bg-ivory border border-warm-grey space-y-3">
      <label className="block text-sm" htmlFor={`${uid}-text`}>{editor.kind === 'note' ? 'Reference note' : 'Task'}
        <textarea id={`${uid}-text`} className="input mt-1" rows={3} maxLength={4000} required value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })} />
      </label>
      {editor.kind === 'task' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm" htmlFor={`${uid}-due`}>Due date (optional)<input id={`${uid}-due`} className="input mt-1" type="date" value={editor.due_on} onChange={e => setEditor({ ...editor, due_on: e.target.value })} /></label>
        <label className="text-sm" htmlFor={`${uid}-state`}>Status<select id={`${uid}-state`} className="input mt-1" value={editor.state} onChange={e => setEditor({ ...editor, state: e.target.value })}>{Object.entries(LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>}
      <div className="flex flex-wrap gap-2"><button disabled={busy} className="btn-primary text-xs">{busy ? 'Saving…' : 'Save'}</button><button type="button" disabled={busy} className="btn-secondary text-xs" onClick={() => {setEditor(null); setError('')}}>Cancel</button></div>
    </form>)
  const workRow = item => (<li key={`${item.source}:${item.id}`} className="py-3 flex flex-wrap sm:flex-nowrap gap-3 items-start">
      <div className="flex-1 min-w-0"><p className={`text-sm whitespace-pre-wrap break-words ${item.state === 'done' ? 'text-ink-60 line-through' : 'text-ink'}`}>{item.text}</p>
        <p className="text-xs text-ink-60 mt-1">{item.kind === 'note' ? 'Reference note' : LABEL[item.state]}{item.due_on && ` · ${item.due_on < today && item.state !== 'done' ? 'Overdue · ' : item.due_on === today ? 'Today · ' : ''}${item.due_on}`}{item.source === 'interaction' && ' · From interaction history'}</p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0"><button disabled={busy} className="btn-secondary text-xs px-3 min-h-[40px]" onClick={() => open(item.kind, item)}>Edit</button>
        <button disabled={busy} className="btn-secondary text-xs px-3 min-h-[40px]" onClick={() => changeState(item, item.state === 'done' ? 'todo' : 'done')}>{item.state === 'done' ? 'Reopen' : item.kind === 'note' ? 'Archive' : 'Done'}</button>
      </div>
    </li>)
  return <section className="p-4 border-b border-warm-grey last:border-b-0" aria-label={`Summary and to-do for ${customerName}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      {showLink ? <Link className="text-brand-600 hover:underline break-words min-w-0" to={`/customers/${customerId}`}>{customerName}</Link> : <h2 className="text-base">Customer to-do</h2>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-xs min-h-[40px] px-3" onClick={() => open('task')}>Add task</button>
        <button className="btn-ghost text-xs min-h-[40px] px-3" onClick={() => open('note')}>Add note</button>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-brand-600 mt-2">{error}</p>}
    <div className="mt-3">
      <h3 className="eyebrow text-brand-600">To-do</h3>
      {editor?.kind === 'task' && editorForm}
      <ul aria-label="To-do list" className="divide-y divide-warm-grey">{tasks.map(workRow)}</ul>
      {!tasks.length && <p className="text-sm text-ink-60 mt-2">No outstanding tasks.</p>}
    </div>
    {(notes.length > 0 || editor?.kind === 'note') && <div className="mt-3 border-t border-warm-grey pt-3">
      <h3 className="eyebrow text-ink-60">Reference notes</h3>
      {editor?.kind === 'note' && editorForm}
      <ul aria-label="Reference notes" className="divide-y divide-warm-grey">{notes.map(workRow)}</ul>
    </div>}
    {!!completed.length && <button className="text-xs text-brand-600 underline min-h-[40px]" onClick={() => setShowDone(v => !v)}>{showDone ? 'Hide completed' : `Show completed / archived (${completed.length})`}</button>}
    {showSummary && <section aria-label="Email and conversation summary" className="mt-4 border border-warm-grey bg-ivory p-3">
      <h3 className="eyebrow text-ink-60">Email &amp; conversation summary</h3>
      {digest && <p className="text-xs text-ink-60 mt-1">AI draft · Last {summaryPeriodLabel(summaryDays)}{generatedAt ? ` · Updated ${generatedAt}` : ''}</p>}
      <SummaryText key={`${customerId}:${summaryDays}:${digest || ''}`} collapse={collapseSummary} previewLength={summaryPreviewLength}
        expandLabel={summaryPreviewLength < 500 ? 'Read full summary' : 'Show more'}
        digest={digest || 'No recent summary. Add a task above to plan your follow-up.'} />
      {sourceLimited && <p className="text-xs text-ink-60 mt-1">Selected excerpts only. Check the customer history for full detail.</p>}
    </section>}
  </section>
}
