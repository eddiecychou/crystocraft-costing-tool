import {resolve} from 'node:path'
// Bounded fictional reads for real Product Design pages. No live SDK/API.
export function pdNavigationFixture(){return {name:'read-only-navigation-fixture',setup(b){
 b.onResolve({filter:/^@\//},a=>a.path.startsWith('@/components/')||['@/lib/jsonPaths','@/lib/jsonHighlight'].includes(a.path)?{path:resolve('src',a.path.slice(2)+(a.path.startsWith('@/components/')||a.path==='@/lib/jsonHighlight'?'.tsx':'.ts'))}:{path:a.path,namespace:'pd-nav'})
 b.onResolve({filter:/^firebase\/(firestore|storage)$|\/domain\/pdProjects$|\/lib\/firestore\/realCustomers$|\/access$/},a=>({path:a.path,namespace:'pd-nav'}))
 b.onLoad({filter:/.*/,namespace:'pd-nav'},a=>({loader:'js',contents:
 a.path==='firebase/firestore'?`export const collection=(db,p)=>p,getDocs=async()=>({docs:[]});export const addDoc=blocked,doc=blocked,updateDoc=blocked,serverTimestamp=blocked,writeBatch=blocked;function blocked(){throw Error('Fixture: no writes')}`
 :a.path==='firebase/storage'?`export const ref=blocked,uploadBytes=blocked,getDownloadURL=blocked,deleteObject=blocked;function blocked(){throw Error('Fixture: no storage')}`
 :a.path.endsWith('/firebase')?'export const db={},storage={};'
 :a.path.endsWith('/access')?'export const useCan=()=>()=>false;'
 :a.path.endsWith('/pdProjects')?`export const listDesignProjects=async()=>[],getDesignProject=async()=>null,designProjectHistory=async()=>({items:[],more:false});export const saveDesignProject=()=>{throw Error('Fixture: no writes')};`
 :a.path.endsWith('/products')?`export const listProducts=async()=>[];export const getProduct=async id=>id==='loading'?new Promise(()=>{}):id==='missing'?null:{id,name:'QA design source',supplierId:'',images:id==='no-photos'?[]:[{id:'qa-photo',url:'/qa-source.svg',caption:'QA reference',isBaseReference:true}],tags:[],status:'active'};export const createProduct=blocked,saveImageAnalysis=blocked,deleteProduct=blocked,updateProduct=blocked,addProductImage=blocked,setBaseReferenceImage=blocked,updateImageCaption=blocked,removeProductImage=blocked;function blocked(){throw Error('Fixture: no writes')}`
 :a.path.endsWith('/realCustomers')?'export const listRealCustomers=async()=>[],getRealCustomer=async()=>null;'
 :a.path.endsWith('/realSuppliers')?'export const listRealSuppliers=async()=>[],getRealSupplier=async()=>null;'
 :a.path.endsWith('/customerBrands')?'export const getCustomerBrand=async()=>null;'
 :a.path.endsWith('/promptTemplates')?`export const getTemplate=async id=>id==='loading'?new Promise(()=>{}):id==='missing'?null:{id,name:'QA template',productId:'qa',customerId:'',tags:[],status:'draft',type:'base',promptJson:{design:{material:'Crystal'}},lockedPaths:[],referenceImages:[]};export const listTemplatesForProduct=async()=>[];export const createTemplate=blocked,updateTemplate=blocked,deleteTemplate=blocked,duplicateTemplate=blocked;function blocked(){throw Error('Fixture: no writes')}`
 :a.path.endsWith('/specSheetTemplates')?`export const listSpecSheetsForProduct=async()=>[];export const getSpecSheet=async id=>id==='loading'?new Promise(()=>{}):id==='missing'?null:{id,productId:id==='missing-product'?'missing':'qa',name:'QA spec sheet',fields:[{label:'Material',value:'Crystal'}]};export const createSpecSheet=blocked,updateSpecSheet=blocked,deleteSpecSheet=blocked;function blocked(){throw Error('Fixture: no writes')}`
 :a.path.endsWith('/generations')?`export const listGenerationsForTemplate=async()=>[];export const createGeneration=blocked,updateGeneration=blocked,deleteGeneration=blocked;function blocked(){throw Error('Fixture: no writes')}`
 :a.path.endsWith('/pdApi')?`export const pdApiFetch=()=>{throw Error('Fixture: no AI requests')};`
 :a.path.endsWith('/catalogueImagePolicy')?`export const catalogueUploadMetadata=blocked,productHeroPatch=blocked;function blocked(){throw Error('Fixture: no writes')}`
 :a.path.endsWith('/pdConcepts')?'export const listApprovedConcepts=async()=>[];'
 :a.path.endsWith('/customer')?'export const customerDisplayName=c=>c.company_name;'
 :a.path.endsWith('/supplier')?'export const supplierDisplayName=s=>s.company_name;'
 :a.path.endsWith('/imageDownloadUrl')?'export const imageDownloadUrl=()=>"";'
 :(()=>{throw Error('Unexpected fixture import '+a.path)})()}))
}}}
