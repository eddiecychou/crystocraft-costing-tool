import {doc,serverTimestamp} from 'firebase/firestore'
import {db} from '../firebase'
import {emptyPipeline,pipelineTransition} from '../customerPipeline'

// Called only after all transaction reads. Existing active requests are untouched.
export function activateCustomerWork(tx,customerId,customer,user,eventId,detail) {
  const before=customer.sales_pipeline||emptyPipeline()
  if(before.status==='active')return
  const after={...pipelineTransition(before,'manual',{status:'active',detail:detail.slice(0,2000)}),revision:before.revision+1,updated_by:user.uid,updatedAt:serverTimestamp(),last_action:'manual',event_id:eventId}
  tx.update(doc(db,'customers',customerId),{sales_pipeline:after})
  tx.set(doc(db,'customers',customerId,'pipeline_history',eventId),{previous:before,pipeline:after,actor:user.uid,at:serverTimestamp(),action:'manual'})
}
