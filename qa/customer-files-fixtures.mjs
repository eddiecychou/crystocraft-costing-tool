import {createHash} from 'node:crypto'
import {createCustomerFilesHandler,CustomerFileError} from '../netlify/functions/lib/customerFiles.js'
import {emptyCustomerFileMetadata,validateCustomerFileMetadata} from '../src/customerFilesModel.js'

export const checksum=bytes=>createHash('sha256').update(bytes).digest('hex')
export const smallPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64')
export const fictionalCompany=()=>({company_name:'QA ONLY — fictional Cindy/Tony VIP example',notes:'Preserve existing notes',contacts:[{id:'person_cindy',name:'Cindy (fictional)'},{id:'person_tony',name:'Tony (fictional)'}],tags:['QA ONLY'],marketing_opt_out:true})
export function customerFilesFixture(){
  const customers=new Map([['qa_vip',fictionalCompany()],['other',{company_name:'Other company',contacts:[]}]]),files=new Map(),blobs=new Map(),calls=[]
  const stamp=()=>({toDate:()=>new Date('2026-11-07T08:00:00Z')})
  const key=(cid,id)=>cid+'/'+id
  const repo={
    getCustomer:async cid=>{calls.push(['customer',cid]);return customers.get(cid)},
    get:async(cid,id)=>files.get(key(cid,id)),
    list:async cid=>({files:[...files.entries()].filter(([k])=>k.startsWith(cid+'/')).map(([,f])=>f),next:null}),
    begin:async(cid,input,uid)=>{
      const existing=[...files.values()].find(f=>f.customer_id===cid&&f.sha256===input.sha256);if(existing)return existing
      const data={id:input.sha256,customer_id:cid,storage_customer_id:cid,...input,...validateCustomerFileMetadata(input.metadata,customers.get(cid)),metadata:undefined,status:'uploading',revision:1,created_at:stamp(),uploaded_at:null,created_by:uid}
      files.set(key(cid,data.id),data);calls.push(['create',cid,data.id]);return data
    },
    complete:async(cid,id)=>{const f=files.get(key(cid,id));if(f.status!=='ready'){f.status='ready';f.uploaded_at=stamp();f.revision++}return f},
    update:async(cid,id,input)=>{const f=files.get(key(cid,id));if(f.revision!==input.revision)throw new CustomerFileError('File details changed in another window.');Object.assign(f,validateCustomerFileMetadata(input.metadata,customers.get(cid),f),{revision:f.revision+1});return f},
    thumbnail:async(cid,id,t)=>Object.assign(files.get(key(cid,id)),{thumbnail_sha256:t.sha256,thumbnail_size:t.byte_size}),
  }
  const objects={
    put:async(path,bytes,type)=>{calls.push(['put',path]);const old=blobs.get(path);if(old&&(!old.bytes.equals(bytes)||old.type!==type))throw new CustomerFileError('Different chunk exists.');blobs.set(path,{bytes:Buffer.from(bytes),type})},
    read:async(path,options={})=>{calls.push(['read',path]);const f=blobs.get(path);if(!f)throw Object.assign(Error('private object missing'),{code:404});return f.bytes.subarray(options.start||0,options.end===undefined?f.bytes.length:options.end+1)},
    removePrefix:async prefix=>{for(const k of blobs.keys())if(k.startsWith(prefix))blobs.delete(k)},
  }
  const profiles={admin:{role:'admin'},crm:{role:'staff',modules:['customers']},supply:{role:'staff',modules:['supply']},marketing:{role:'staff',modules:['marketing']},customer:{role:'customer',status:'approved',customer_id:'qa_vip',modules:['customers']},pending:{role:'customer',status:'pending',customer_id:'qa_vip'},none:{role:'staff',modules:[]}}
  const handler=createCustomerFilesHandler({verifyToken:async token=>{if(token==='bad')throw Error();return{uid:token}},getProfile:async uid=>profiles[uid],repo,objects})
  const request=(op,{method='GET',cid='qa_vip',id,chunk,kind,body,token='admin',extra={}}={})=>handler(new Request('https://example.test/api/customer-files?'+new URLSearchParams({customer:cid,op,...(id?{file:id}:{}),...(chunk!==undefined?{chunk:String(chunk)}:{}),...(kind?{kind}:{}),...extra}),{method,headers:token?{Authorization:'Bearer '+token}:{},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})}))
  const begin=async(bytes=smallPng,meta={},filename='Cindy & Tony 中文 🎁.png',type='image/png')=>{
    const response=await request('begin',{method:'POST',body:{filename,content_type:type,byte_size:bytes.length,sha256:checksum(bytes),metadata:{...emptyCustomerFileMetadata(),...meta}}})
    return{response,...await response.json()}
  }
  return{customers,files,blobs,calls,repo,objects,profiles,handler,request,begin}
}
