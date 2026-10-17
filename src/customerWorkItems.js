// Pure CRM projections shared by both screens. Legacy interactions remain intact.
export const WORK_STATES = ['todo', 'waiting', 'done']
export function dateOnly(value) {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = value.toDate?.() || new Date(value.seconds != null ? value.seconds * 1000 : value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
export function cleanWorkItem(input) {
  const text = String(input.text || '').trim()
  if (!text || text.length > 4000) throw new Error('Enter a task or note of up to 4,000 characters.')
  const kind = input.kind
  if (!['task', 'note'].includes(kind)) throw new Error('Choose task or note.')
  const state = input.state || 'todo'
  if (!WORK_STATES.includes(state)) throw new Error('Choose To do, Waiting or Done.')
  const due_on = kind === 'task' ? (input.due_on || '') : ''
  if (due_on && (!/^\d{4}-\d{2}-\d{2}$/.test(due_on) || new Date(due_on+'T12:00:00Z').toISOString().slice(0,10) !== due_on)) throw new Error('Choose a valid due date.')
  return { text, kind, state, due_on }
}
export function legacyWorkItems(enquiries = []) {
  return enquiries.filter(e => e.follow_up_date || e.todo_status).map(e => ({
    id: e.id, source: 'interaction', kind: 'task', customerId: e.customerId,
    text: e.todo_text ?? e.description ?? 'Follow up',
    due_on: e.todo_due_on ?? dateOnly(e.follow_up_date),
    state: e.todo_status || 'todo', revision: e.todo_revision || 0,
  }))
}
export function sortWorkItems(items, today = dateOnly(new Date())) {
  const rank = i => i.state === 'done' ? 5 : i.kind === 'note' ? 4 : i.due_on && i.due_on < today ? 0 : i.due_on === today ? 1 : i.state === 'waiting' ? 3 : 2
  return [...items].sort((a,b) => rank(a)-rank(b) || (a.due_on || '9999').localeCompare(b.due_on || '9999') || a.id.localeCompare(b.id))
}
export function combineWorkItems(enquiries, items) {
  return sortWorkItems([...legacyWorkItems(enquiries), ...items.map(i => ({ ...i, source: 'work_item' }))])
}
export function hasOpenWork(items) { return items.some(i => i.state !== 'done') }
export function assertRevision(current, expected, field = 'revision') {
  if (!current || (current[field] || 0) !== expected) throw new Error('This item changed in another tab. Close the editor and reopen the latest item.')
}
