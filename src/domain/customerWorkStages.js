import {doc,runTransaction,serverTimestamp} from 'firebase/firestore'
import {db,authedUser} from '../firebase'
import {cleanWorkStages,WORK_STAGES} from '../dashboardWorkbench'
import {activateCustomerWork} from './customerWorkActivation'

export async function saveCustomerWorkStages(customerId,expectedRevision,stages,eventId=crypto.randomUUID()) {
  const clean=cleanWorkStages(stages),user=await authedUser()
  if(!user)throw Error('Please sign in.')
  return runTransaction(db,async tx=>{
    const ref=doc(db,'customers',customerId),snap=await tx.get(ref)
    if(!snap.exists()||snap.data().customer_merge_lock)throw Error('Customer is missing or being merged. Your draft is still here.')
    const customer=snap.data(),before=customer.dashboard_work
    if(before?.event_id===eventId){if(JSON.stringify(before.stages)!==JSON.stringify(clean))throw Error('This draft was already saved. Reopen it before changing it.');return}
    if((before?.revision||0)!==expectedRevision)throw Error('Work stages changed in another tab. Your draft is still here; reopen the latest stages before saving.')
    tx.update(ref,{dashboard_work:{stages:clean,revision:expectedRevision+1,event_id:eventId,updated_by:user.uid,updatedAt:serverTimestamp()}})
    if(clean.length)activateCustomerWork(tx,customerId,customer,user,`stage_${eventId}`,`Current work: ${clean.map(s=>WORK_STAGES[s]).join(', ')}`)
  })
}
