export const SUMMARY_PERIODS = [{days:14,label:'2 weeks'},{days:30,label:'1 month'},{days:90,label:'3 months'}]
export function summaryDays(value=30){const days=Number(value);if(!SUMMARY_PERIODS.some(p=>p.days===days))throw Error('Choose 2 weeks, 1 month or 3 months.');return days}
export const summaryCacheId = days => summaryDays(days)===30?'weekly_summary':`customer_summary_${summaryDays(days)}`
export const summaryPeriodLabel = days => SUMMARY_PERIODS.find(p=>p.days===Number(days))?.label || '1 month'
export const validSummaryCache = id => ['weekly_summary','customer_summary_14','customer_summary_90'].includes(id)
// Prioritize current activity while reserving a spread of earlier evidence for long periods.
export function summarySource(enquiries=[],emails=[],whatsapp=[],budget=24000){
 const events=[...enquiries.map(e=>({date:e.date?.toISOString?.()||'',text:`CRM ${e.channel || ''}: ${e.description || ''}`})),
 ...emails.flatMap(t=>t.messages.map(m=>({date:m.date,text:`Email / ${t.subject} / ${m.from}: ${m.snippet}`}))),
 ...whatsapp.flatMap(t=>t.messages.map(m=>({date:m.date,text:`${t.channel || 'WhatsApp'} / ${t.subject} / ${m.from}: ${m.snippet}`})))].sort((a,b)=>b.date.localeCompare(a.date))
 const lines=events.map(e=>`[${e.date.slice(0,10)}] ${e.text}`)
 if(lines.join('\n').length<=budget)return {text:lines.join('\n'),limited:false}
 const selected=new Map();let used=0
 for(let i=0;i<lines.length&&used<budget*0.6;i++){const text=lines[i].slice(0,1500);if(used+text.length+1>budget*0.6)break;selected.set(i,text);used+=text.length+1}
 // Evenly sample remaining older activity rather than dropping the whole older period.
 const remaining=lines.map((_,i)=>i).filter(i=>!selected.has(i)),step=Math.max(1,Math.ceil(remaining.length/20))
 const indices=[...new Set([remaining.at(-1),...remaining.filter((_,i)=>i%step===0),...remaining])].filter(i=>i!==undefined)
 for(const i of indices){const text=lines[i].slice(0,1500);if(used+text.length+1<=budget){selected.set(i,text);used+=text.length+1}}
 return {text:[...selected].sort((a,b)=>a[0]-b[0]).map(([,v])=>v).join('\n'),limited:true}
}
