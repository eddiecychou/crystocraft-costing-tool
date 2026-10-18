// Read-only production preflight. Never mutates rules, objects or documents.
// Uses curl because this Mac's Node Google connections can time out.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {firebaseReadonly} from './lib/swatch-read-only.mjs'
const dir='migration/crystal-swatches-v819.local';mkdirSync(dir,{recursive:true,mode:0o700})
const read=firebaseReadonly()
function preserve(path,content){
 if(existsSync(path)){if(readFileSync(path,'utf8')!==content)throw Error('Refusing to replace the original preflight snapshot: '+path)}
 else writeFileSync(path,content,{mode:0o600})
}
const project='projects/crystocraft-costing'
const releases=read(`https://firebaserules.googleapis.com/v1/${project}/releases`).releases
for(const type of ['firestore','storage']){
 const release=releases.find(r=>r.name.includes('/releases/'+(type==='firestore'?'cloud.firestore':'firebase.storage/')))
 if(!release)throw Error('Missing '+type+' release')
 const rules=read('https://firebaserules.googleapis.com/v1/'+release.rulesetName)
 const content=rules.source.files.map(f=>f.content).join('\n')
 preserve(`${dir}/${type}-before.rules`,content)
 console.log(type,{ruleset:release.rulesetName,sha256:createHash('sha256').update(content).digest('hex')})
}
for(const name of ['crystal_swatch_notes','crystal_swatches','crystal_migration_runs']){
 const data=read(`https://firestore.googleapis.com/v1/${project}/databases/(default)/documents/${name}?pageSize=1000`)
 if(data.nextPageToken)throw Error('Preflight needs pagination for '+name)
 preserve(`${dir}/${name}-before.json`,JSON.stringify(data,null,2));console.log(name,(data.documents||[]).length)
}
