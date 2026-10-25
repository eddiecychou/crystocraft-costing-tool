// Bundle the real pages. Only unrelated integrations are replaced; workspace UI,
// projections, subscriptions, transactions, and the Firestore SDK remain real.
import {readFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
export async function workspaceSyncPlugin(){
 const stubs=new Map(),keep=new Set(['../components/CustomerWorkspace','../hooks/useSummaryPeriod','../hooks/useSummaryUpdate','../hooks/useOcToday','../customerSummary','../domain/customerWorkItems','../customerWorkItems','../ocTime','../ocTime.js','../components/LoadingBar'])
 // Keep the real status hook/store; only the unrelated AI boundary is blocked.
 stubs.set(resolve('src/domain/weeklySummary'), "export async function generateWeeklySummary(){throw Error('AI generation is disabled in the workspace sync fixture')}")
 const special={
  normalizeCustomer:'c=>({...c,contacts:c.contacts||[],tags:c.tags||[]})',RETAIL_TAG:'"Retail Customer"',
  useCan:'()=>()=>false',useRole:'()=>"admin"',useCustomerAssets:'()=>({assets:[]})',
  loadProposal:'async()=>null',loadBlogProducts:'async()=>[]',loadCustomers:'async()=>[]',listApprovedConcepts:'async()=>[]',
  useRates:'()=>({})',CUSTOMER_CURRENCIES:'["USD","HKD"]',fromUSD:'v=>v',
  mergeSalesInvoiceHistory:'()=>[]',CHANNELS:'[]',NO_API_CHANNELS:'[]',WHATSAPP_TRANSCRIBE_LANGUAGES:'[]',
  orderStatusOf:'s=>({label:s})',orderUc:'o=>o.uc_no',CustomerPipeline:'()=>null',
 }
 for(const page of ['src/pages/Dashboard.jsx','src/pages/CustomerDetail.jsx']){
  const source=await readFile(page,'utf8')
  for(const match of source.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm)){
   const [,names,path]=match;if(!path.startsWith('.')||keep.has(path)||path==='../firebase')continue
   const exports=[]
   if(!names.trim().startsWith('{')){
    const name=names.trim().split(',')[0].trim()
    const implementation=path.includes('useScrollMemory')?'()=>()=>{}':/^use[A-Z]/.test(name)
     ? `()=>{throw Error(${JSON.stringify('Unconfigured hook in workspace fixture: '+path+'; retain it or provide an explicit stub')})}`
     :'()=>null'
    exports.push(`export default ${implementation};`)
   }
   const named=names.match(/\{([^}]+)\}/)?.[1]||''
   for(const name of named.split(',').map(n=>n.trim().split(/\s+as\s+/)[0]).filter(Boolean))exports.push(`export const ${name}=${special[name]||`()=>{throw Error('Unexpected unrelated integration: ${name}')}`};`)
   const key=resolve(dirname(page),path);let previous=stubs.get(key)||''
   for(const declaration of exports){const signature=declaration.match(/^export (?:const \w+|default)/)[0];if(!previous.includes(signature+'=' )&&!previous.includes(signature+' '))previous+='\n'+declaration}
   stubs.set(key,previous)
  }
 }
 return {name:'emulator-only-workspace-pages',setup(b){
  b.onResolve({filter:/^\.\.?\//},a=>{
   if(/\/firebase$/.test(a.path))return {path:'firebase',namespace:'sync-fixture'}
   const path=resolve(a.resolveDir,a.path);if(stubs.has(path))return {path,namespace:'sync-fixture'}
  })
  b.onLoad({filter:/.*/,namespace:'sync-fixture'},a=>({loader:'js',contents:a.path==='firebase'
   ? 'export const db=globalThis.__workspaceSyncDb;export const storage={};export const authedUser=async()=>({uid:"sync_admin"});export const authHeader=async()=>({});'
   :stubs.get(a.path)}))
 }}
}
