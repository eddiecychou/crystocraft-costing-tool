import {validatePipelineSuggestions} from './customerPipeline.js'
// Small requests plus singleton fallback isolate bad AI output. Successful
// proposals stage normally; unsupported results never bypass validation.
export async function runPipelineSuggestions(entries,{request,save,onProgress=()=>{}}) {
  let saved=0,reviewed=0;const failed=[]
  async function process(batch) {
    const response=await request(batch)
    if(!response.ok) {
      if(response.status!==502)throw Error(response.data.error||'Could not prepare suggestions. Confirmed positions are unchanged.')
      if(batch.length>1){for(const item of batch)await process([item]);return}
      failed.push({id:batch[0].id,code:response.data.code||'invalid_output'});reviewed++;onProgress(reviewed,entries.length);return
    }
    const suggestions=validatePipelineSuggestions(response.data,batch)
    for(const s of suggestions){await save(s);saved++}
    reviewed+=batch.length;onProgress(reviewed,entries.length)
  }
  for(let start=0;start<entries.length;start+=2)await process(entries.slice(start,start+2))
  if(failed.length)throw Error(`${saved} suggestions prepared; ${failed.length} customer summaries could not be checked (${[...new Set(failed.map(f=>f.code))].join(', ')}). Retry to resume. Confirmed positions are unchanged.`)
  return saved
}
