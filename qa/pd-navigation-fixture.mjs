// Bounded fictional reads for real Product Design pages. No live SDK/API.
export function pdNavigationFixture(){return {name:'read-only-navigation-fixture',setup(b){
 b.onResolve({filter:/^@\//},a=>({path:a.path,namespace:'pd-nav'}))
 b.onResolve({filter:/^firebase\/firestore$|\/domain\/pdProjects$|\/lib\/firestore\/realCustomers$|\/access$/},a=>({path:a.path,namespace:'pd-nav'}))
 b.onLoad({filter:/.*/,namespace:'pd-nav'},a=>({loader:'js',contents:
 a.path==='firebase/firestore'?'export const collection=(db,p)=>p,getDocs=async()=>({docs:[]});'
 :a.path.endsWith('/firebase')?'export const db={};'
 :a.path.endsWith('/access')?'export const useCan=()=>()=>false;'
 :a.path.endsWith('/pdProjects')?`export const listDesignProjects=async()=>[],getDesignProject=async()=>null,designProjectHistory=async()=>({items:[],more:false});export const saveDesignProject=()=>{throw Error('Fixture: no writes')};`
 :a.path.endsWith('/products')?`export const listProducts=async()=>[];export const deleteProduct=()=>{throw Error('Fixture: no writes')};`
 :a.path.endsWith('/realCustomers')?'export const listRealCustomers=async()=>[];'
 :a.path.endsWith('/realSuppliers')?'export const listRealSuppliers=async()=>[];'
 :a.path.endsWith('/pdConcepts')?'export const listApprovedConcepts=async()=>[];'
 :a.path.endsWith('/customer')?'export const customerDisplayName=c=>c.company_name;'
 :a.path.endsWith('/supplier')?'export const supplierDisplayName=s=>s.company_name;'
 :a.path.endsWith('/imageDownloadUrl')?'export const imageDownloadUrl=()=>"";'
 :(()=>{throw Error('Unexpected fixture import '+a.path)})()}))
}}}
