import { asOcDate } from './ocTime.js'
export const PROJECT_REFERENCE_LIMIT=4
export const PROJECT_STAGES=['Idea','In design','Awaiting feedback','Sourcing / costing','Ready for handoff','On hold','Completed']
export const PROJECT_LINKS={customer:'/customers/',supplier:'/suppliers/',corp_product:'/products/',range_product:'/range/',concept:'/design/templates/'}
export const LINK_LABELS={customer:'Customer',supplier:'Supplier',corp_product:'Corporate Gift',range_product:'Range product',concept:'Approved concept',repo:'Repository evidence',reference:'Reference'}
export const emptyProject=()=>({title:'',customerId:null,customerLabel:'',internalGroup:'',projectType:'',status:'Idea',brief:'',currentState:'',nextAction:'',waitingOn:'',leadImageUrl:'',links:[],archived:false})
export function validWebUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!/[\s<>]/.test(value)}catch{return false}}
export function validProjectImage(value){if(!value)return true;if(!validWebUrl(value))return false;return ['firebasestorage.googleapis.com','storage.googleapis.com','portal.crystocraft.com','crystocraft.com','www.crystocraft.com'].includes(new URL(value).hostname)}
const idValid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)
export function cleanProject(input){
 const p=emptyProject()
 for(const [key,max]of Object.entries({title:160,customerLabel:200,internalGroup:120,projectType:80,brief:2000,currentState:1200,nextAction:600,waitingOn:300,leadImageUrl:2000})){
  if(typeof input[key]!=='string'||input[key].length>max)throw Error(`Check ${key}: maximum ${max} characters.`)
  p[key]=input[key].trim()
 }
 if(!p.title)throw Error('Give the project a title.')
 if(!PROJECT_STAGES.includes(input.status))throw Error('Choose a valid design stage.')
 p.status=input.status
 if(input.customerId!==null&&!idValid(input.customerId))throw Error('Choose a valid customer.')
 p.customerId=input.customerId
 if(p.customerId)p.internalGroup=''
 else p.customerLabel=''
 if(typeof input.archived!=='boolean')throw Error('Choose a valid archive setting.')
 p.archived=input.archived
 if(!validProjectImage(p.leadImageUrl))throw Error('Use an existing OC, Crystocraft or Firebase Storage HTTPS image URL.')
 if(p.leadImageUrl)p.leadImageUrl=new URL(p.leadImageUrl).href
 if(!Array.isArray(input.links)||input.links.length>PROJECT_REFERENCE_LIMIT)throw Error('Use up to four reference links.')
 p.links=input.links.map(l=>{
  if(!Object.hasOwn(LINK_LABELS,l.type)||typeof l.label!=='string'||l.label.length>160)throw Error('Choose a reference type and a short label.')
  if(Object.hasOwn(PROJECT_LINKS,l.type)){
   if(!idValid(l.recordId))throw Error('Enter the linked OC record ID.')
   return {type:l.type,label:l.label.trim(),recordId:l.recordId,url:PROJECT_LINKS[l.type]+l.recordId}
  }
  if(typeof l.url!=='string'||l.url.length>2000||!validWebUrl(l.url))throw Error('Reference links must be HTTPS URLs without embedded credentials.')
  return {type:l.type,label:l.label.trim(),recordId:'',url:new URL(l.url).href}
 })
 return p
}
export function projectCustomer(p,customers={}){return p.customerId?(customers[p.customerId]||p.customerLabel||`Customer ${p.customerId}`):(p.internalGroup||'Internal / Crystocraft Range')}
export function projectWaiting(p){return !p.archived&&!['On hold','Completed'].includes(p.status)&&(p.status==='Awaiting feedback'||!!p.waitingOn?.trim())}
export function projectMatches(p,view='Active',search='',customer='all',customers={}){
 const active=!p.archived&&!['On hold','Completed'].includes(p.status)
 const included={All:true,Active:active,Waiting:projectWaiting(p),'On hold':!p.archived&&p.status==='On hold',Completed:!p.archived&&p.status==='Completed',Archived:p.archived}[view]
 return !!included&&(customer==='all'||(customer==='internal'?!p.customerId:p.customerId===customer))&&[p.title,projectCustomer(p,customers),p.currentState,p.nextAction,p.waitingOn,p.status].join(' ').toLowerCase().includes(search.trim().toLowerCase())
}
export function projectTime(value){return value?.toMillis?.()??(value?.seconds?value.seconds*1000:asOcDate(value).getTime()||0)}
export function projectGroups(projects,customers={}){
 const groups=new Map()
 for(const p of [...projects].sort((a,b)=>projectTime(b.updatedAt)-projectTime(a.updatedAt)||a.id.localeCompare(b.id))){const key=p.customerId||'internal';if(!groups.has(key))groups.set(key,{key,label:p.customerId?projectCustomer(p,customers):'Internal projects',projects:[]});groups.get(key).projects.push(p)}
 return [...groups.values()].sort((a,b)=>projectTime(b.projects[0].updatedAt)-projectTime(a.projects[0].updatedAt))
}
// A reusable human-readable handoff; applying it changes only the local form.
export function parseProjectHandoff(text){
 if(typeof text!=='string'||text.length>8000)throw Error('Use a short update (up to 8,000 characters).')
 const keys={'current state':'currentState','next action':'nextAction','waiting on':'waitingOn',decision:'note'},result={};let key
 for(const line of text.split('\n')){const m=line.match(/^([A-Za-z ]+):\s*(.*)$/);if(m){key=keys[m[1].trim().toLowerCase()];if(!key)throw Error('Use Current state, Next action, Waiting on and Decision headings.');if(Object.hasOwn(result,key))throw Error('Use each heading once.');result[key]=m[2]}else if(key)result[key]+='\n'+line;else if(line.trim())throw Error('Start with Current state: or another supported heading.')}
 if(!Object.keys(result).length)throw Error('Paste a project update first.')
 for(const k of Object.keys(result))result[k]=result[k].trim()
 return result
}
