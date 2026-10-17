// Local-only UI fixture. No Firebase or live business writes.
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {CustomerPipeline} from '../src/components/CustomerPipeline'
import {pipelineTransition} from '../src/customerPipeline'
function Preview(){
 const [pipeline,setPipeline]=useState({revision:1,status:'active',detail:'Existing order agreed; a second sample and price request remains active.',last_reviewed_source:'',suggestion:{status:'active',detail:'Keep the repeat sample and price request active while the existing order proceeds.',reason:'An unresolved repeat-order request remains.',evidence:'Customer requested another sample and pricing.',source_key:'fixture',based_on_revision:0}})
 return <main className="p-4 max-w-3xl"><h1 className="text-xl mb-4">Pipeline review — fictional QA fixture</h1><p className="text-sm mb-4">Confirmed active customers: {pipeline.status==='active'?1:0}. A suggestion never changes this number.</p><div className="card"><CustomerPipeline customer={{id:'fictional',company_name:'QA Repeat-order Customer',sales_pipeline:pipeline}} save={async(id,revision,action,input)=>{if(revision!==pipeline.revision)throw Error('Position changed');const next=pipelineTransition(pipeline,action,input);setPipeline({...next,revision:pipeline.revision+1,last_action:action,updatedAt:{toDate:()=>new Date()}})}}/></div></main>
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Preview/></MemoryRouter>)
