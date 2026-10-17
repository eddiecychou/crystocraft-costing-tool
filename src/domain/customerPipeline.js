import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db, authedUser } from '../firebase'
import { emptyPipeline, pipelineTransition, summaryKey } from '../customerPipeline'
import {runPipelineSuggestions} from '../pipelineSuggestionRun'
import {summaryCacheId, validSummaryCache} from '../customerSummary'

export async function savePipelineDecision(customerId, expectedRevision, action, input, eventId = crypto.randomUUID()) {
  const user = await authedUser()
  if (!user) throw Error('Please sign in.')
  const customerRef = doc(db,'customers',customerId)
  return runTransaction(db, async tx => {
    const snap = await tx.get(customerRef)
    if (!snap.exists() || snap.data().customer_merge_lock) throw Error('Customer is missing or being merged. Reopen the customer.')
    const before = snap.data().sales_pipeline || emptyPipeline()
    if (before.event_id === eventId) return // same operation retry
    if (before.revision !== expectedRevision) throw Error('Pipeline changed in another tab. Reopen the latest position.')
    if (action === 'suggest' || action === 'confirm') {
      const cacheId=(action==='suggest'?input.suggestion?.source_cache:before.suggestion?.source_cache) || 'weekly_summary'
      if(!validSummaryCache(cacheId))throw Error('Choose a valid summary period.')
      const summary = await tx.get(doc(db,'dashboard_cache',cacheId))
      const digest = summary.data()?.items?.find(i => i.customerId === customerId)?.digest || ''
      const key = action === 'suggest' ? input.suggestion?.source_key : input.sourceKey
      if (!digest || await summaryKey(digest) !== key) throw Error('The summary changed. Refresh suggestions before confirming.')
    }
    const next = pipelineTransition(before,action,input)
    if (!next) return
    const after = { ...next, revision:before.revision+1, updated_by:user.uid, updatedAt:serverTimestamp(), last_action:action, event_id:eventId }
    tx.update(customerRef,{sales_pipeline:after})
    tx.set(doc(db,'customers',customerId,'pipeline_history',eventId),{previous:before,pipeline:after,actor:user.uid,at:serverTimestamp(),action})
  })
}

// Reads the shared summaries, never raw mail or another customer's portal data.
// Small batches avoid silent caps/truncation; a failure leaves reviewed positions intact.
export async function suggestCustomerPipeline(customers, onProgress = () => {}, days = 30) {
  const user = await authedUser()
  if (!user) throw Error('Please sign in.')
  const cacheId=summaryCacheId(days)
  const cache = await getDoc(doc(db,'dashboard_cache',cacheId))
  if(!cache.exists())throw Error('Refresh summaries for this period first, then prepare suggestions.')
  const byId = new Map(customers.map(c => [c.id,c]))
  const entries = []
  for (const item of cache.data()?.items || []) {
    const c = byId.get(item.customerId)
    if (!c || !item.digest || item.digest === '(no digest returned)') continue
    const key = await summaryKey(item.digest), pipeline = c.sales_pipeline || emptyPipeline()
    if (pipeline.last_reviewed_source === key || pipeline.suggestion?.source_key === key) continue
    entries.push({id:c.id,name:c.company_name || '',digest:item.digest,source_key:key,source_cache:cacheId,pipeline:{revision:pipeline.revision,status:pipeline.status,detail:pipeline.detail}})
  }
  return runPipelineSuggestions(entries,{
    onProgress,
    request:async batch=>{
      const token=await user.getIdToken()
      const response=await fetch('/api/pipeline-suggestions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({customers:batch})})
      return {ok:response.ok,status:response.status,data:await response.json().catch(()=>({}))}
    },
    save:async s=>savePipelineDecision(s.id,s.based_on_revision,'suggest',{suggestion:{status:s.status,detail:s.detail,reason:s.reason,evidence:s.evidence,source_key:s.source_key,source_cache:s.source_cache,based_on_revision:s.based_on_revision}}),
  })
}
