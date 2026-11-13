// Dashboard scope and projections. No Firestore or AI side effects.
export const REVIEW_PERIODS = [30,60,90,180,365]
export const WORK_STAGES = {exploration:'Exploration',quotation:'Quotation',order:'Order & Production'}
export const WORK_STAGE_DESCRIPTIONS = {
  exploration:'Ongoing discussions before a quotation or PI is issued for this project.',
  quotation:'A customer quotation is being prepared or has been sent.',
  order:'A confirmed order or PI is progressing through production and delivery.',
}
export function isDashboardB2B(customer) {
  if (!customer || customer.id === 'online-crystocraft-o07' || customer.tags?.includes('Not a Real Customer')) return false
  if (customer.customer_type === 'retail') return false
  if (customer.customer_type === 'b2b') return true
  return !customer.tags?.includes('Retail Customer')
}
export function contactTime(value, now = Date.now()) {
  if (value == null || value === '') return null
  const date = value?.toDate?.() || (typeof value === 'object' && Number.isFinite(value.seconds) ? new Date(value.seconds * 1000) : new Date(value))
  const time = date.getTime()
  return Number.isFinite(time) && time >= 0 && time <= now ? time : null
}
export function cleanWorkStages(stages) {
  if (!Array.isArray(stages) || stages.some(stage=>!Object.hasOwn(WORK_STAGES,stage))) throw Error('Choose valid work stages.')
  return Object.keys(WORK_STAGES).filter(stage=>stages.includes(stage))
}
export function groupCustomerItems(customers, enquiries, work, combine) {
  const history = new Map(), native = new Map()
  for (const [rows,map] of [[enquiries,history],[work,native]]) for (const item of rows) {
    if (!map.has(item.customerId)) map.set(item.customerId,[])
    map.get(item.customerId).push(item)
  }
  return new Map(customers.map(c=>[c.id,combine(history.get(c.id)||[],native.get(c.id)||[])]))
}
export function dashboardTasks(customers, grouped, today, filter='all') {
  const rows=[]
  for (const customer of customers.filter(isDashboardB2B)) for (const item of grouped.get(customer.id)||[]) {
    if (item.kind !== 'task' || item.state === 'done') continue
    if (filter === 'due' && (!item.due_on || item.due_on > today)) continue
    if (filter === 'waiting' && item.state !== 'waiting') continue
    rows.push({...item,customerId:customer.id,customer})
  }
  return rows.sort((a,b)=>(a.due_on||'9999').localeCompare(b.due_on||'9999') || (a.customer.company_name||'').localeCompare(b.customer.company_name||''))
}
export function customerWorkRows({customers,grouped,quotes=[],orders=[],activity=[],days=30,now=Date.now()}) {
  const contacts=new Map(activity.map(c=>[c.customerId,c])), quoteMap=new Map(), orderMap=new Map()
  for (const [records,map,allowed] of [[quotes,quoteMap,['draft','sent']],[orders,orderMap,['confirmed','packing','ready']]]) {
    for (const record of records) if (!record.shipping_closed && allowed.includes(String(record.status||'').toLowerCase()) && record.customer_id) {
      if (!map.has(record.customer_id)) map.set(record.customer_id,[])
      map.get(record.customer_id).push(record)
    }
  }
  return customers.filter(isDashboardB2B).map(customer=>{
    const tasks=(grouped.get(customer.id)||[]).filter(i=>i.kind==='task'&&i.state!=='done')
    const linkedQuotes=quoteMap.get(customer.id)||[], linkedOrders=orderMap.get(customer.id)||[]
    const manual=Array.isArray(customer.dashboard_work?.stages)?customer.dashboard_work.stages.filter(s=>Object.hasOwn(WORK_STAGES,s)):[]
    const stages=Object.keys(WORK_STAGES).filter(s=>manual.includes(s)||(s==='quotation'&&linkedQuotes.length)||(s==='order'&&linkedOrders.length))
    const active=tasks.length>0 || customer.sales_pipeline?.status==='active' || stages.length>0
    const contact=contacts.get(customer.id), lastContact=contactTime(contact?.lastContactAt,now)
    const recent=lastContact!==null && lastContact>=now-days*86400000
    return {customer,tasks,stages,quotes:linkedQuotes,orders:linkedOrders,active,recent,lastContact,historyState:contact?.historyState||'unknown'}
  }).filter(row=>row.active||row.recent).sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastContact||0)-(a.lastContact||0)||(a.customer.company_name||'').localeCompare(b.customer.company_name||''))
}
// Unknown/partial history must never silently qualify as a verified quiet period.
export function quietCustomerIds(activity,days=90,now=Date.now()) {
  return new Set(activity.filter(c=>c.historyState==='known' && contactTime(c.lastContactAt,now)!==null && contactTime(c.lastContactAt,now)<=now-days*86400000).map(c=>c.customerId))
}
