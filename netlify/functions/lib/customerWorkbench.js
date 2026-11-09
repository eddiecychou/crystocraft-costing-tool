import {isDashboardB2B,contactTime} from '../../../src/dashboardWorkbench.js'

const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store',Vary:'Authorization','X-Content-Type-Options':'nosniff'}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers})
const CHANNELS=new Set(['Email','WhatsApp Business','Personal WhatsApp','WhatsApp','Alibaba','Phone','Call','Meeting','WeChat'])
export function projectCustomerActivity(customers,records,now=Date.now()) {
  const result=new Map(customers.filter(isDashboardB2B).map(c=>[c.id,{customerId:c.id,lastContactAt:null,historyState:'unknown'}]))
  const add=(id,value)=>{
    const row=result.get(id);if(!row)return
    const date=contactTime(value,now)
    if(date===null){row.partial=true;return}
    if(!row.lastContactAt||date>Date.parse(row.lastContactAt))row.lastContactAt=new Date(date).toISOString()
  }
  for(const c of customers)for(const field of ['last_contacted','lastOutreachAt'])if(c[field])add(c.id,c[field])
  for(const record of records){
    const match=record.path?.match(/^customers\/([^/]+)\/(email_threads|whatsapp_threads|alibaba_threads|enquiries)\/[^/]+$/)
    if(!match||!result.has(match[1])||record.migrated_to)continue
    if(match[2]==='enquiries'){
      if(CHANNELS.has(record.channel))add(match[1],record.date)
      else if(!['Internal','Note','Reference note','Draft'].includes(record.channel))result.get(match[1]).partial=true
    }else add(match[1],record.date_range?.[1] || record.last_message_at)
  }
  return [...result.values()].map(({partial,...row})=>({...row,historyState:partial?'partial':row.lastContactAt?'known':'unknown'}))
}
export function createCustomerWorkbenchHandler({verifyToken,getProfile,load,now=()=>Date.now()}) {
  return async req=>{
    if(req.method!=='GET')return json({error:'Method not allowed.'},405)
    const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if(!token||token.length>8192)return json({error:'Please sign in.'},401)
    let uid
    try{uid=(await verifyToken(token)).uid;if(!uid||uid==='mcp-range-upload-service')throw Error()}catch{return json({error:'Please sign in again.'},401)}
    try{
      const profile=await getProfile(uid)
      if(!(profile?.role==='admin'||profile?.role==='staff'&&Array.isArray(profile.modules)&&profile.modules.includes('customers')))return json({error:'Access denied.'},403)
      const {customers,records}=await load(), checkedAt=now()
      return json({checkedAt:new Date(checkedAt).toISOString(),customers:projectCustomerActivity(customers,records,checkedAt)})
    }catch{return json({error:'Contact history could not load. Try again; no quiet-customer selection was made.'},503)}
  }
}
// Selected header fields only: message bodies and attachments never enter this service.
export async function loadCustomerActivity(db,documentId) {
  async function pages(target){
    const rows=[];let cursor
    for(let page=0;page<100;page++){
      const query=cursor?target.orderBy(documentId()).startAfter(cursor).limit(500):target.orderBy(documentId()).limit(500)
      const snap=await query.get()
      rows.push(...snap.docs.map(d=>({...d.data(),id:d.id,path:d.ref.path})))
      if(snap.size<500)return rows
      cursor=snap.docs.at(-1)
    }
    throw Error('Contact history is too large for one review.')
  }
  const [customers,...groups]=await Promise.all([
    pages(db.collection('customers').select('customer_type','tags','last_contacted','lastOutreachAt')),
    ...['email_threads','whatsapp_threads','alibaba_threads','enquiries'].map(name=>pages(db.collectionGroup(name).select('date_range','last_message_at','migrated_to','channel','date'))),
  ])
  return {customers,records:groups.flat()}
}
