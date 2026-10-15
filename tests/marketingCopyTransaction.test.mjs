import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fixtureSource } from '../qa/marketing-copy-fixture.mjs'
const bundled = await build({ stdin: { contents: `export * from './src/marketingRegeneration.js'; export {fixtureRecords} from 'firebase/firestore'`, resolveDir:process.cwd() },bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^(firebase\/firestore|\.\/firebase)$/},()=>({path:'fixture',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixtureSource,loader:'js'}));
}}]})
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const preview = {approved:true,status:'previewed',before:'',after:'Approved copy',previewId:'preview-1'}
test('new IDs read without a historical allowlist', async()=>assert.equal((await api.readTarget('new-mcp-id')).name,'New product'))
test('unapproved or changed guidance cannot write',async()=>{
 await assert.rejects(api.applyApproved('new-mcp-id',{...preview,approved:false},'run'),/not been approved/)
 await assert.rejects(api.applyApproved('new-mcp-id',{...preview,guidance:'Changed'},'run'),/current instructions/)
 assert.equal(api.fixtureRecords().length,5)
})
test('atomic backup, approved save, and same-preview retry preserve original history',async()=>{
 await api.applyApproved('new-mcp-id',preview,'run')
 const rows = new Map(api.fixtureRecords())
 assert.equal(rows.get('products/new-mcp-id').marketing_description,'Approved copy')
 assert.equal(rows.get('product_marketing_history/run_new-mcp-id_preview-1').previous_description,'')
 assert.equal(rows.get('product_marketing_history/run_new-mcp-id_preview-1').replacement_description,'Approved copy')
 await api.applyApproved('new-mcp-id',preview,'run')
 assert.equal(api.fixtureRecords().length,6)
})
test('concurrent copy changes reject without a backup or overwrite',async()=>{
 await assert.rejects(api.applyApproved('stale',preview,'run'),/changed since preview/)
 assert.equal((await api.readTarget('stale')).marketing_description,'Externally changed')
 assert.equal(api.fixtureRecords().length,6)
})
test('full scan includes compliant and new products',async()=>assert.equal((await api.verifyTargets()).length,5))
