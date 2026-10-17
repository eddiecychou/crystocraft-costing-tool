// Evidence text is always copied from the saved digest by the server, never repaired
// or paraphrased from AI output. References are local to one customer/request.
export function pipelineEvidence(digest) {
  const passages=[]
  for(let start=0;start<digest.length;) {
    let end=Math.min(start+900,digest.length)
    if(end<digest.length){const space=digest.lastIndexOf(' ',end);if(space>start+450)end=space}
    passages.push({id:`E${passages.length+1}`,text:digest.slice(start,end)})
    start=end
  }
  return passages
}
export function resolvePipelineEvidence(result,customers) {
  if(!Array.isArray(result?.suggestions))throw Error('incomplete_suggestions')
  const byId=new Map(customers.map(c=>[c.id,c]))
  return {suggestions:result.suggestions.map(s=>{
    // Retain strict legacy quote validation for an in-flight/older response.
    if(s.evidence_ref===undefined)return s
    const c=byId.get(s.id),passage=c&&pipelineEvidence(c.digest).find(p=>p.id===s.evidence_ref)
    if(!passage)throw Error('unknown_evidence_reference')
    return {...s,evidence:passage.text}
  })}
}
