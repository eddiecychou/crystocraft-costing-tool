// Local release evidence only. GETs and OAuth exchange; no production writer.
import {readFileSync} from 'node:fs'
import {createSign} from 'node:crypto'
import {execFileSync} from 'node:child_process'
export function firebaseReadonly() {
 const key=JSON.parse(readFileSync('firebase-service-account.json','utf8')),b=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000)
 const payload=b({alg:'RS256',typ:'JWT'})+'.'+b({iss:key.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})
 const assertion=payload+'.'+createSign('RSA-SHA256').update(payload).sign(key.private_key).toString('base64url')
 const token=JSON.parse(execFileSync('curl',['-sS','--max-time','20','--fail-with-body','--data-binary','@-','https://oauth2.googleapis.com/token'],{input:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),encoding:'utf8'})).access_token
 return url=>{
  const u=new URL(url)
  if(u.protocol!=='https:' || !['firestore.googleapis.com','firebaserules.googleapis.com','storage.googleapis.com'].includes(u.hostname))throw Error('Unexpected evidence host.')
  return JSON.parse(execFileSync('curl',['-sS','--max-time','30','--fail-with-body','--config','-'],{input:`url = "${u.href}"\nheader = "Authorization: Bearer ${token}"\n`,encoding:'utf8',maxBuffer:8*1024*1024}))
 }
}
export function decodeFirestore(value) {
 if(value==null || 'nullValue' in value)return null
 if('mapValue' in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decodeFirestore(v)]))
 if('arrayValue' in value)return (value.arrayValue.values||[]).map(decodeFirestore)
 if('integerValue' in value || 'doubleValue' in value)return Number(value.integerValue??value.doubleValue)
 return value.stringValue??value.booleanValue??value.timestampValue
}
